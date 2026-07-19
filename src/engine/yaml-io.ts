/**
 * yaml-io.ts — js-yaml v5 移行の互換ラッパー（純粋・R2）。
 *
 * v5 は `load("")`（空/空白のみの入力）を YAMLException で投げる（v4 は undefined を返した）。
 * 空 YAML ＝「まだ何も無い」は本リポジトリでは正当な状態（空テーマ・生成途中の図など）なので、
 * v4 セマンティクス（空 → undefined）をここ **1箇所** に封じ、全 load 呼び出しが共有する（R8 —
 * 各呼び出し元に trim ガードを散らばらせない）。dump は v5 でも挙動互換なので素通し。
 */
import * as yaml from "js-yaml";

/** `yaml.load` の v4 互換版：空/空白のみの入力は undefined（v5 の throw を吸収）。 */
export function loadYaml(text: string): unknown {
  return text.trim() ? yaml.load(text) : undefined;
}
