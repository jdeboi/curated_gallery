/*
 * Circle-wobble scene - second shader-based scene, same plumbing as
 * js/reactionDiffusion.js (an offscreen WEBGL p5.Graphics rendered with a
 * custom shader, then blitted into the wall panel's 2D buffer via
 * pg.image() - see that file's header for why a WEBGL side-buffer is
 * needed at all).
 *
 * Unlike reaction-diffusion, this one has no feedback loop / persistent
 * ink state - it's a pure function of time and pixel position (a field of
 * metaballs orbiting the origin, rendered as a Turing-pattern-style
 * band-pass/stripe pattern), so there's nothing to seed and no scratch
 * buffer: just one WEBGL buffer, re-rendered from scratch every frame off
 * `millis()`.
 *
 * Shader by SamuelYAN (https://twitter.com/SamuelAnn0924,
 * https://www.instagram.com/samuel_yan_1990/), vendored verbatim aside
 * from the CW_ prefix. The full-screen-quad vertex shader is Adam
 * Ferriss's p5jsShaderExamples pattern (https://github.com/aferriss/
 * p5jsShaderExamples): it ignores p5's normal projection/model matrices
 * entirely and just remaps aPosition's unit quad straight to clip space,
 * so the rect() size passed at the call site doesn't matter - only that
 * it draws a quad at all.
 */

const CW_VERT = `
attribute vec3 aPosition;
attribute vec2 aTexCoord;

void main() {
  vec4 positionVec4 = vec4(aPosition, 1.0);
  positionVec4.xy = positionVec4.xy * 2.0 - 1.0;
  gl_Position = positionVec4;
}
`;

const CW_FRAG = `
#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform float u_time;

float hash(float n){
    return fract(sin(n)*43758.5453123);
}

vec2 cellPos(float id, float t){
    float a = hash(id)*6.283 * 1. - t*0.05;
    float r = .75 - 0.25*sin(t*0.3+id);
    return vec2(cos(a),sin(a))*r;
}

float metaball(vec2 p, vec2 c, float r){
    float d = length(p-c);
    return r*r/(d*d+0.05);
}

// Activation - Inhibition Field
float turingField(vec2 p){

    const int CELLS = 256;

    float act = 0.1;
    float inh = 0.25;

    for(int i=0;i<CELLS;i++){
        float id = float(i);
        vec2 cp = cellPos(id,u_time);

        act += metaball(p,cp,0.05);
        inh += metaball(p,cp,0.35);
    }

    float field = act + inh*0.7;

    // Normalize into visible range
    field = field*0.99 - 0.5;

    return field;
}

void main(){

    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 p = uv * 1. - 1.;
    p.x *= u_resolution.x/u_resolution.y;

    float field = turingField(p);

    // Band-pass (zero-cross emphasis)
    float band = smoothstep(0.1,0.5,field)
               - smoothstep(0.5,0.9,field);

    // Secondary modulation for labyrinth
    float stripes = sin(field * 2.0);
    stripes = smoothstep(-1.0,1.2,stripes);

    float pattern = clamp(band + stripes*0.99, 0.0, 1.0);

    // Monochrome output
    vec3 col = vec3(pattern);

    gl_FragColor = vec4(col,1.0);
}
`;

let cwGfx;
let cwShader;

// WALL_BOUNDS (js/wall.js) is fixed once initWallPanels() runs in setup(),
// so in practice this only ever does real work on its first call - it's a
// guard, not a per-frame resize handler.
function cwEnsureBuffer() {
  const w = Math.max(1, Math.round(WALL_BOUNDS.w));
  const h = Math.max(1, Math.round(WALL_BOUNDS.h));
  if (cwGfx && cwGfx.width === w && cwGfx.height === h) return;

  cwGfx = createGraphics(w, h, WEBGL);
  cwGfx.pixelDensity(1);
  cwGfx.noStroke();
  cwShader = cwGfx.createShader(CW_VERT, CW_FRAG);
}

function initCircleWobble() {
  cwEnsureBuffer();
}

function updateCircleWobble() {
  cwGfx.shader(cwShader);
  cwShader.setUniform("u_resolution", [cwGfx.width, cwGfx.height]);
  cwShader.setUniform("u_time", millis() / 1000);
  // Size args are irrelevant here - see the header note on CW_VERT
  // discarding p5's usual position/scale transform.
  cwGfx.rect(0, 0, cwGfx.width, cwGfx.height);
}

function drawCircleWobble(pg) {
  pg.image(cwGfx, 0, 0, WALL_BOUNDS.w, WALL_BOUNDS.h);
}
