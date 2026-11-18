import Phaser from 'phaser';
import { LIGHT_RANGE } from './LightGrid';

const FRAG = `
#define SHADER_NAME PW_LIGHTING_FS
precision mediump float;
uniform sampler2D uMainSampler;
uniform sampler2D uLightmap;
uniform vec2 uViewOrigin;
uniform vec2 uViewSize;
uniform vec2 uLightOrigin;
uniform vec2 uLightSize;
uniform float uRange;
varying vec2 outTexCoord;

void main() {
  vec4 color = texture2D(uMainSampler, outTexCoord);
  // Framebuffer textures are bottom-up; world space is top-down.
  vec2 world = uViewOrigin + vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uViewSize;
  vec2 luv = (world - uLightOrigin) / uLightSize;
  vec3 light = texture2D(uLightmap, luv).rgb * uRange;
  gl_FragColor = vec4(color.rgb * light, color.a);
}
`;

/**
 * Camera post-FX that multiplies everything the world camera rendered by the tile lightmap.
 * Because it runs on the world camera only, the parallax sky (rendered by another camera) is
 * never darkened twice, and light sources may over-brighten (values up to LIGHT_RANGE).
 */
export class LightingPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  static readonly KEY = 'PWLighting';

  lightTexture: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null = null;
  readonly viewOrigin = { x: 0, y: 0 };
  readonly viewSize = { x: 1, y: 1 };
  readonly lightOrigin = { x: 0, y: 0 };
  readonly lightSize = { x: 1, y: 1 };

  constructor(game: Phaser.Game) {
    super({ game, name: LightingPipeline.KEY, fragShader: FRAG });
  }

  override onDraw(renderTarget: Phaser.Renderer.WebGL.RenderTarget): void {
    if (!this.lightTexture) {
      this.bindAndDraw(renderTarget);
      return;
    }
    this.set1i('uLightmap', 1);
    this.set2f('uViewOrigin', this.viewOrigin.x, this.viewOrigin.y);
    this.set2f('uViewSize', this.viewSize.x, this.viewSize.y);
    this.set2f('uLightOrigin', this.lightOrigin.x, this.lightOrigin.y);
    this.set2f('uLightSize', this.lightSize.x, this.lightSize.y);
    this.set1f('uRange', LIGHT_RANGE);
    this.bindTexture(this.lightTexture, 1);
    this.bindAndDraw(renderTarget);
    // Batching pipelines cache which texture is bound to each unit; we just changed unit 1
    // behind their back, so invalidate those caches.
    this.manager?.pipelines.each((_key: string, pipeline: Phaser.Renderer.WebGL.WebGLPipeline) => {
      const cache = (pipeline as unknown as { activeTextures?: unknown[] }).activeTextures;
      if (cache) cache.length = 0;
      return true;
    });
    this.gl.activeTexture(this.gl.TEXTURE0);
  }
}
