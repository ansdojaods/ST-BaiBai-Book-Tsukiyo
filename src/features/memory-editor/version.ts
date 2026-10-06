/**
 * 剧情剪辑台 · 版本与兼容目标
 *
 * 这一处集中放版本事实，方便升级时只改一个地方：
 *  - EDITOR_VERSION      本模块（剧情剪辑台）自己的版本；
 *  - MIN_ENGINE_VERSION  能跑本模块的最低引擎版本；
 *  - TARGET_ENGINE_VERSION 本模块预期随哪一版引擎发布。
 *
 * 注意：本模块**不**决定插件版本。插件版本在引擎仓库根目录的 `manifest.json`
 * （`version` 与 `js` 的 `?ver=` 两处），以及你们的 CHANGELOG 里，需要一起改。
 */
export const EDITOR_VERSION = "1.0.0";
export const MIN_ENGINE_VERSION = "1.3.4";
export const TARGET_ENGINE_VERSION = "1.4.0";

export const VERSIONS = {
  editor: EDITOR_VERSION,
  minEngine: MIN_ENGINE_VERSION,
  targetEngine: TARGET_ENGINE_VERSION,
} as const;
