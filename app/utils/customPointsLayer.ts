import Layer from "ol/layer/Layer";
import type { FrameState } from "ol/Map";
import type { SymbolAtlas } from "./symbolAtlas";

/**
 * Custom WebGL2 point layer (the deferred custom renderer — see
 * docs/future/custom-webgl-renderer.md).
 *
 * Unlike the stock WebGLPointsLayer path, this owns its GPU buffers directly and renders
 * straight from the columnar FeatureStore — there are NO ol/Feature objects, so the ~0.5-1 GB
 * of per-object overhead at 1M is gone. It also interpolates position on the GPU: each point
 * carries a `prev` and `target` attribute and the vertex shader does `mix(prev, target, u_t)`
 * against a single time uniform, so smooth 60fps motion between ticks costs nothing on the CPU
 * (no per-frame buffer rebuild, which is what makes this impossible on the stock layer).
 *
 * It integrates via ol/layer/Layer's `render(frameState)` option: we keep our own <canvas> +
 * WebGL2 context, size it to the viewport each frame, draw, and return it for compositing.
 * Rotation is assumed 0 (the map has rotation disabled).
 */

const VERTEX_SRC = `#version 300 es
precision highp float;

in vec2 a_corner;    // quad corner in [-0.5, 0.5]
in vec2 a_prev;      // previous position (Web Mercator)
in vec2 a_target;    // target position (Web Mercator)
in float a_variant;  // atlas cell index
in float a_rotation; // heading, radians (0 = north), clockwise

uniform vec2 u_center;     // view center (Web Mercator)
uniform float u_resolution; // map units per CSS pixel
uniform vec2 u_halfSize;   // half the viewport in CSS pixels
uniform float u_t;         // interpolation factor [0, 1]
uniform float u_spritePx;  // sprite size in CSS pixels
uniform float u_atlasWidth;
uniform float u_cellPx;

out vec2 v_uv;

void main() {
  vec2 world = mix(a_prev, a_target, u_t);

  // World -> normalized device coordinates (no rotation).
  vec2 clipCenter = (world - u_center) / (u_resolution * u_halfSize);

  // Rotate the quad corner clockwise by the heading, then offset in pixels.
  float s = sin(a_rotation);
  float c = cos(a_rotation);
  vec2 rc = vec2(a_corner.x * c + a_corner.y * s, -a_corner.x * s + a_corner.y * c);
  vec2 offsetClip = rc * u_spritePx / u_halfSize;

  gl_Position = vec4(clipCenter + offsetClip, 0.0, 1.0);

  // Sub-sprite texture coordinate within the single-row atlas.
  vec2 cellUV = a_corner + 0.5;
  float cellW = u_cellPx / u_atlasWidth;
  v_uv = vec2(a_variant * cellW + cellUV.x * cellW, cellUV.y);
}`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_atlas;
out vec4 outColor;
void main() {
  vec4 tex = texture(u_atlas, v_uv);
  if (tex.a < 0.05) discard;
  outColor = tex;
}`;

// Triangle-strip quad corners; (corner + 0.5) also yields [0,1] texture coords.
const QUAD = new Float32Array([
  -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5,
]);

const SPRITE_PX = 28;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error("Shader compile failed: " + gl.getShaderInfoLog(shader));
  }
  return shader;
}

export class CustomPointsLayer {
  readonly layer: Layer;
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private prevVbo: WebGLBuffer;
  private targetVbo: WebGLBuffer;
  private variantVbo: WebGLBuffer;
  private rotVbo: WebGLBuffer;
  private texture: WebGLTexture;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private atlasWidth: number;
  private cellPx: number;
  // Positions are uploaded relative to this origin so the shader works in small numbers
  // (absolute Web Mercator ~1e7 loses ~1.5 m of float32 precision, which jitters interpolation).
  private originX = 0;
  private originY = 0;

  private count = 0;
  private tickStart = 0;
  private tickDuration = 1;
  // Set on each uploadTick; the next render captures tickStart from frameState.time so the
  // interpolation clock always matches OpenLayers' render clock.
  private pendingReset = true;

  constructor(atlas: SymbolAtlas) {
    this.atlasWidth = atlas.width;
    this.cellPx = atlas.cell;

    const canvas = document.createElement("canvas");
    // Overlay the map like OL's own layer canvases (the composite container stacks children).
    canvas.className = "ol-layer";
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error("WebGL2 not available for custom points layer");
    this.gl = gl;

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SRC));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("Program link failed: " + gl.getProgramInfoLog(program));
    }
    this.program = program;

    for (const name of [
      "u_center",
      "u_resolution",
      "u_halfSize",
      "u_t",
      "u_spritePx",
      "u_atlasWidth",
      "u_cellPx",
      "u_atlas",
    ]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }

    // VAO with the shared quad + per-instance attributes.
    const vao = gl.createVertexArray()!;
    this.vao = vao;
    gl.bindVertexArray(vao);

    const quadVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    const aCorner = gl.getAttribLocation(program, "a_corner");
    gl.enableVertexAttribArray(aCorner);
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);

    this.prevVbo = this.makeInstanceAttrib(program, "a_prev", 2);
    this.targetVbo = this.makeInstanceAttrib(program, "a_target", 2);
    this.variantVbo = this.makeInstanceAttrib(program, "a_variant", 1);
    this.rotVbo = this.makeInstanceAttrib(program, "a_rotation", 1);

    gl.bindVertexArray(null);

    // Atlas texture (uploaded synchronously from the atlas canvas).
    const texture = gl.createTexture()!;
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      atlas.canvas,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.layer = new Layer({
      render: (frameState) => this.render(frameState),
    });
  }

  private makeInstanceAttrib(
    program: WebGLProgram,
    name: string,
    size: number,
  ): WebGLBuffer {
    const gl = this.gl;
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const loc = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(loc, 1);
    return vbo;
  }

  /** Set the coordinate origin that uploaded positions are relative to. */
  setOrigin(x: number, y: number) {
    this.originX = x;
    this.originY = y;
  }

  /** Upload the (static) per-instance atlas variant indices once. */
  setVariants(variant: Uint8Array, count: number) {
    const gl = this.gl;
    const data = new Float32Array(count);
    for (let i = 0; i < count; i++) data[i] = variant[i];
    gl.bindBuffer(gl.ARRAY_BUFFER, this.variantVbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.count = count;
  }

  /**
   * Upload a new tick: prev/target interleaved [x,y] positions and per-point rotation.
   * `tickDurationMs` is how long to interpolate from prev to target before the next tick.
   */
  uploadTick(
    prev: Float32Array,
    target: Float32Array,
    rot: Float32Array,
    tickDurationMs: number,
  ) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.prevVbo);
    gl.bufferData(gl.ARRAY_BUFFER, prev, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.targetVbo);
    gl.bufferData(gl.ARRAY_BUFFER, target, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rotVbo);
    gl.bufferData(gl.ARRAY_BUFFER, rot, gl.DYNAMIC_DRAW);
    this.tickDuration = Math.max(1, tickDurationMs);
    this.pendingReset = true;
  }

  private render(frameState: FrameState): HTMLCanvasElement {
    const gl = this.gl;
    const { size, pixelRatio, viewState, time } = frameState;
    const width = Math.round(size[0] * pixelRatio);
    const height = Math.round(size[1] * pixelRatio);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.canvas.style.width = size[0] + "px";
    this.canvas.style.height = size[1] + "px";

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.count === 0) return this.canvas;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    if (this.pendingReset) {
      this.tickStart = time;
      this.pendingReset = false;
    }
    const t = Math.min(1, (time - this.tickStart) / this.tickDuration);
    gl.uniform2f(
      this.uniforms.u_center,
      viewState.center[0] - this.originX,
      viewState.center[1] - this.originY,
    );
    gl.uniform1f(this.uniforms.u_resolution, viewState.resolution);
    gl.uniform2f(this.uniforms.u_halfSize, size[0] / 2, size[1] / 2);
    gl.uniform1f(this.uniforms.u_t, t);
    gl.uniform1f(this.uniforms.u_spritePx, SPRITE_PX);
    gl.uniform1f(this.uniforms.u_atlasWidth, this.atlasWidth);
    gl.uniform1f(this.uniforms.u_cellPx, this.cellPx);
    gl.uniform1i(this.uniforms.u_atlas, 0);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);

    gl.bindVertexArray(null);
    return this.canvas;
  }
}
