import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';
import { isPowder } from '../simulation/PowderSolver.mjs';
import { Phase } from '../simulation/Phase.mjs';
import { phaseAppearance } from '../simulation/PhaseSolver.mjs';
import { LIQUID_SURFACE, liquidSurfaceRadius, vapourSurfaceRadius, frozenSurfaceWeight, frostSurfaceColor } from './MaterialRaster.mjs';

const STRIDE = 12;
const PARTICLE_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_circle;
layout(location=1) in vec3 a_color;
layout(location=2) in vec3 a_light;
layout(location=3) in vec3 a_grain;
uniform vec2 u_size;
out vec2 v_local;
out vec3 v_color;
out vec3 v_light;
flat out vec3 v_grain;
void main() {
  vec2 corners[4] = vec2[4](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(1,1));
  v_local = corners[gl_VertexID];
  vec2 pixel = a_circle.xy + v_local * a_circle.z;
  gl_Position = vec4(pixel / u_size * 2.0 - 1.0, 0, 1);
  v_color = a_color; v_light = a_light; v_grain = a_grain;
}`;
const PARTICLE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_local;
in vec3 v_color;
in vec3 v_light;
flat in vec3 v_grain;
uniform int u_grains;
out vec4 out_color;
void main() {
  float d = dot(v_local, v_local);
  if (d >= 1.0) discard;
  if (u_grains == 0) {
    float weight = (1.0-d)*(1.0-d)*v_grain.z;
    float facet = mod(floor(v_local.x*8.0)*3.0+floor(v_local.y*8.0)*5.0+v_grain.y,13.0);
    float iceShade = facet < 2.0 ? 1.08 : facet == 6.0 ? .94 : 1.0;
    out_color = vec4((v_color*(1.0+(iceShade-1.0)*v_grain.x) + v_light*.22)*weight, weight);
  } else {
    float alpha = .99*v_grain.z;
    if (v_grain.x > 2.5) {
      // Stable per-grain tone: no trigonometric noise or centre mark per
      // fragment. The physical circles still overlap and move individually.
      float shade = .96 + (fract((v_grain.y+1.0)*.61803398875)-.5)*.12;
      out_color = vec4(clamp(v_color*shade + v_light*.22,0.0,1.0)*alpha, alpha);
    } else {
      float noise = fract(sin(dot(floor(v_local*3.0),vec2(23.0,41.0)) + v_grain.y)*67.0);
      float shade = .94 + v_local.y*.08 + (noise-.5)*.14;
      out_color = vec4(clamp(v_color*shade + v_light*.22,0.0,1.0)*alpha, alpha);
    }
  }
}`;
const SURFACE_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p*2.0-1.0,0,1);
}`;
const SURFACE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_field;
uniform vec2 u_size;
uniform int u_vapour;
out vec4 out_color;
void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  vec4 field = texture(u_field, uv);
  float density = field.a;
  if (density <= .0001) { out_color=vec4(0); return; }
  vec3 color = field.rgb / density;
  float alpha;
  if (u_vapour == 1) {
    // Optical depth joins overlapping steam parcels without an opaque gas skin.
    alpha = min(.76, 1.0-exp(-density*.28));
  } else {
    alpha = ${LIQUID_SURFACE.opacity}*clamp((density-${LIQUID_SURFACE.cutoff})/${LIQUID_SURFACE.edge},0.0,1.0);
    float above = texture(u_field, uv+vec2(0,1.0/u_size.y)).a;
    float contour = 1.0-smoothstep(.35,.8,above);
    color *= .94 + clamp((density-above)*.16,0.0,.18)*contour;
  }
  out_color = vec4(clamp(color,0.0,1.0)*alpha,alpha);
}`;

function program(gl, vertex, fragment) {
  const result = gl.createProgram(), shaders = [];
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type); shaders.push(shader);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(result, shader);
    }
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result));
    return result;
  } catch (error) { gl.deleteProgram(result); throw error; }
  finally { for (const shader of shaders) gl.deleteShader(shader); }
}

/** Bounded, vessel-sized half-float density fields. Every parcel is submitted
 * once in a phase batch; the GPU accumulates LOCAL colour and reconstructs the
 * continuous surface. No CPU pixel loops, texture uploads, or GPU readbacks. */
export class FluidSurfaceGPU {
  static create(ownerDocument) {
    let renderer;
    try {
      renderer = new FluidSurfaceGPU(ownerDocument.createElement('canvas'));
      return renderer;
    } catch { renderer?.dispose(); return null; }
  }
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true,
      antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!this.gl) throw new Error('WebGL2 is unavailable.');
    this.groups = []; this.fields = []; this.capacity = 0;
    this.available = false; this.disposed = false;
    this.appearance = { liquid: 0, gas: 0, solid: 0 };
    this.stats = { drawCalls: 0, uploadedBytes: 0, particles: 0, glowingParticles: 0, width: 0, height: 0 };
    this.onLost = event => { event.preventDefault(); this.available = false; };
    this.onRestored = () => {
      if (this.disposed) return;
      try { this.initialize(); } catch { this.available = false; }
    };
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    try { this.initialize(); }
    catch (error) { this.dispose(); throw error; }
  }
  initialize() {
    const gl = this.gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Half-float surfaces are unavailable.');
    gl.getExtension('EXT_float_blend');
    this.particles = program(gl, PARTICLE_VERTEX, PARTICLE_FRAGMENT);
    this.surface = program(gl, SURFACE_VERTEX, SURFACE_FRAGMENT);
    this.particleSize = gl.getUniformLocation(this.particles, 'u_size');
    this.grainMode = gl.getUniformLocation(this.particles, 'u_grains');
    this.surfaceSize = gl.getUniformLocation(this.surface, 'u_size');
    this.vapourMode = gl.getUniformLocation(this.surface, 'u_vapour');
    this.groups = [0, 1, 2].map(() => {
      const buffer = gl.createBuffer(), vao = gl.createVertexArray();
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [index, size, offset] of [[0, 3, 0], [1, 3, 3], [2, 3, 6], [3, 3, 9]]) {
        gl.enableVertexAttribArray(index);
        gl.vertexAttribPointer(index, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
        gl.vertexAttribDivisor(index, 1);
      }
      return { buffer, vao, data: new Float32Array(0), count: 0 };
    });
    this.fields = [0, 1].map(() => ({ texture: gl.createTexture(), target: gl.createFramebuffer() }));
    this.capacity = 0; this.width = this.height = 0;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.DITHER); gl.enable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    this.available = true;
  }
  resize(width, height) {
    if (this.width === width && this.height === height) return;
    const gl = this.gl;
    this.canvas.width = this.width = width; this.canvas.height = this.height = height;
    gl.viewport(0, 0, width, height);
    for (const field of this.fields) {
      gl.bindTexture(gl.TEXTURE_2D, field.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, field.target);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, field.texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Cannot allocate the fluid density field.');
    }
    this.stats.width = width; this.stats.height = height;
  }
  drawGroup(group, grains) {
    if (!group.count) return;
    const gl = this.gl;
    gl.useProgram(this.particles); gl.uniform2f(this.particleSize, this.width, this.height);
    gl.uniform1i(this.grainMode, grains); gl.bindVertexArray(group.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, group.count); this.stats.drawCalls++;
  }
  drawSurface(field, vapour) {
    const gl = this.gl;
    gl.useProgram(this.surface); gl.uniform2f(this.surfaceSize, this.width, this.height);
    gl.uniform1i(this.vapourMode, vapour); gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, field.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 3); this.stats.drawCalls++;
  }
  render(ps, t, particleColor, scratch, auras, effectsScale = 1, resolution = 40, rawSolids = null) {
    if (!this.available || this.disposed) return false;
    const gl = this.gl, scale = Math.min(t.scale, resolution);
    try { this.resize(Math.ceil(4.7 * scale) + 4, Math.ceil(2.4 * scale) + 4); }
    catch { this.available = false; return false; }
    if (this.capacity < ps.count) {
      this.capacity = Math.max(64, ps.capacity);
      for (const group of this.groups) {
        group.data = new Float32Array(this.capacity * STRIDE);
        gl.bindBuffer(gl.ARRAY_BUFFER, group.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, group.data.byteLength, gl.DYNAMIC_DRAW);
      }
    }
    for (const group of this.groups) group.count = 0;
    this.stats.drawCalls = this.stats.uploadedBytes = this.stats.glowingParticles = 0;
    this.stats.particles = ps.count;
    const appearance = this.appearance;
    for (let i = 0; i < ps.count; i++) {
      phaseAppearance(ps, i, appearance);
      const physical = effectiveParticleRadius(ps, i, true) * scale;
      const dry = isPowder(ps, i) && ps.powderContent[i] > .85;
      const aura = auras[i], light = Math.max(0, Math.min(1, effectsScale)) * (aura?.intensity || 0);
      if (light > .0001) this.stats.glowingParticles++;
      // A transitioning parcel contributes to both fields with complementary
      // weights. No trails, duplicate mass or abrupt opaque steam discs.
      // Ice formed from liquid uses the same contiguous density surface on
      // WebGL as on canvas; only powders and intact ingredients keep grit.
      const cohesiveFrozen = ps.frozenRadius?.[i] > 0 ||
        (ps.phase[i] === Phase.LIQUID && ps.phaseTarget[i] === Phase.SOLID);
      const ice = frozenSurfaceWeight(ps, i, appearance);
      for (let phase = 0; phase < 3; phase++) {
        const weight = phase === 0 ? appearance.liquid + (cohesiveFrozen ? appearance.solid : 0) :
          phase === 1 ? appearance.gas : (cohesiveFrozen ? 0 : appearance.solid);
        if (weight <= 0) continue;
        const group = this.groups[phase], n = group.count++ * STRIDE, data = group.data;
        data[n] = this.width / 2 + ps.x[i] * scale;
        data[n + 1] = this.height / 2 + ps.y[i] * scale;
        data[n + 2] = phase === 2 ? Math.max(1, Math.ceil(physical * 2)) / 2 :
          phase === 1 ? vapourSurfaceRadius(ps, i, scale) : liquidSurfaceRadius(ps, i, scale);
        particleColor(ps, i, scratch);
        if (phase === 0) frostSurfaceColor(scratch, ice);
        data[n + 3] = scratch.r / 255; data[n + 4] = scratch.g / 255; data[n + 5] = scratch.b / 255;
        for (let k = 0; k < 3; k++) data[n + 6 + k] = light * (aura?.unquantized[k] || 0) / 255;
        data[n + 9] = phase === 0 ? ice : phase === 2 ? (dry ? 3 : 2) : 0; data[n + 10] = i; data[n + 11] = weight;
      }
    }
    for (const group of this.groups) if (group.count) {
      gl.bindBuffer(gl.ARRAY_BUFFER, group.buffer);
      const length = group.count * STRIDE;
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, group.data, 0, length); this.stats.uploadedBytes += length * 4;
    }
    // Two additive half-float fields avoid 8-bit saturation or colour clipping
    // in dense pools. Surfaces cost one fullscreen triangle each, within only
    // the vessel's bounds, independent of devicePixelRatio.
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = 0; i < 2; i++) {
      if (!this.groups[i].count) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fields[i].target); gl.clear(gl.COLOR_BUFFER_BIT);
      this.drawGroup(this.groups[i], 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (this.groups[0].count) this.drawSurface(this.fields[0], 0);
    this.drawGroup(this.groups[2], 1);
    if (this.groups[1].count) this.drawSurface(this.fields[1], 1);
    this.outputScale = t.scale / scale;
    return true;
  }
  composite(ctx, t) {
    const s = this.outputScale;
    ctx.drawImage(this.canvas, t.cx - this.width * s / 2, t.cy - this.height * s / 2,
      this.width * s, this.height * s);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.available = false;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    const gl = this.gl;
    for (const group of this.groups) { gl.deleteBuffer(group.buffer); gl.deleteVertexArray(group.vao); }
    for (const field of this.fields) { gl.deleteTexture(field.texture); gl.deleteFramebuffer(field.target); }
    gl.deleteProgram(this.particles); gl.deleteProgram(this.surface);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
