/**
 * layout-augment-xml.ts — レイアウト合成（#568）用の小さな文字列処理: placeholder の `<a:lstStyle>` に
 * レベル別の sz を書く。layout-augment.ts から分けたのは R1（400 行）と単体テストのしやすさのため。
 *
 * スキーマ順を守る: lstStyle の子は defPPr, lvl1pPr … lvl9pPr, extLst の順。lvlNpPr の中で defRPr は
 * extLst より前（他の子の後ろ）。txBody の子は bodyPr, lstStyle, p…。純粋（R2）。
 */

const lvlRe = (k: number) => new RegExp(`<a:lvl${k}pPr\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/a:lvl${k}pPr>)`);

/** この shape 自身の lstStyle に明示された lvl k の sz（pt）。無ければ undefined。 */
export function explicitLevelSize(sp: string, k: number): number | undefined {
  const ls = sp.match(/<a:lstStyle>([\s\S]*?)<\/a:lstStyle>/)?.[1];
  const sz = ls?.match(lvlRe(k))?.[2]?.match(/<a:defRPr\b[^>]*?\bsz="(\d+)"/)?.[1];
  return sz ? +sz / 100 : undefined;
}

/** lstStyle の中身 `inner` の lvl k に sz を書く（無ければ lvlKpPr / defRPr を作る）。 */
function setLevel(inner: string, k: number, pt: number): string {
  const sz = String(Math.round(pt * 100));
  const m = inner.match(lvlRe(k));
  if (m) {
    const attrs = m[1];
    let body = m[2] ?? "";
    if (/<a:defRPr\b[^>]*?\bsz="/.test(body)) body = body.replace(/(<a:defRPr\b[^>]*?\bsz=")\d+"/, `$1${sz}"`);
    else if (/<a:defRPr\b/.test(body)) body = body.replace(/<a:defRPr\b/, `<a:defRPr sz="${sz}"`);
    else if (/<a:extLst\b/.test(body)) body = body.replace(/<a:extLst\b/, `<a:defRPr sz="${sz}"/><a:extLst`);
    else body += `<a:defRPr sz="${sz}"/>`;
    return inner.slice(0, m.index!) + `<a:lvl${k}pPr${attrs}>${body}</a:lvl${k}pPr>` + inner.slice(m.index! + m[0].length);
  }
  const el = `<a:lvl${k}pPr><a:defRPr sz="${sz}"/></a:lvl${k}pPr>`;
  // Insert before the first higher level (or extLst), keeping schema order.
  const next = inner.search(new RegExp(`<a:lvl[${k + 1}-9]pPr\\b|<a:extLst\\b`));
  return next === -1 ? inner + el : inner.slice(0, next) + el + inner.slice(next);
}

/** shape（`<p:sp>…</p:sp>`）の lstStyle に、レベル（1 始まり）→ pt を書き込む。 */
export function setLevelSizes(sp: string, sizes: ReadonlyMap<number, number>): string {
  const write = (inner: string) => [...sizes].sort((a, b) => a[0] - b[0]).reduce((acc, [k, pt]) => setLevel(acc, k, pt), inner);
  const full = sp.match(/<a:lstStyle>([\s\S]*?)<\/a:lstStyle>/);
  if (full) return sp.replace(full[0], `<a:lstStyle>${write(full[1])}</a:lstStyle>`);
  const ls = `<a:lstStyle>${write("")}</a:lstStyle>`;
  if (/<a:lstStyle\s*\/>/.test(sp)) return sp.replace(/<a:lstStyle\s*\/>/, ls);
  if (/<a:bodyPr\b[^>]*\/>/.test(sp)) return sp.replace(/(<a:bodyPr\b[^>]*\/>)/, `$1${ls}`);
  if (/<\/a:bodyPr>/.test(sp)) return sp.replace(/<\/a:bodyPr>/, `</a:bodyPr>${ls}`);
  // No txBody at all: add a minimal one (sp children: nvSpPr, spPr, style?, txBody, extLst?).
  const tx = `<p:txBody><a:bodyPr/>${ls}<a:p><a:endParaRPr/></a:p></p:txBody>`;
  return /<p:extLst\b/.test(sp) ? sp.replace(/<p:extLst\b/, `${tx}<p:extLst`) : sp.replace(/<\/p:sp>$/, `${tx}</p:sp>`);
}

export interface LevelProps {
  bold?: boolean; // defRPr@b="1"
  algn?: "ctr"; // lvlNpPr@algn
  noBullet?: boolean; // <a:buNone/> と marL/indent 0（見出し・KPI の数値/ラベル）
}

/** pPr の子のうち箇条記号の要素（スキーマ順: … buFont, [buNone|buAutoNum|buChar|buBlip], tabLst, defRPr, extLst）。 */
const BULLET_RE = /<a:bu(?:None|AutoNum|Char|Blip)\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/a:bu(?:AutoNum|Char|Blip)>)/;

/** lstStyle の lvl k に太字・揃え・箇条なしを書く。lvl k が無ければ作る（setLevelSizes の後に呼ぶ想定）。 */
export function setLevelProps(sp: string, k: number, props: LevelProps): string {
  const withLvl = lvlRe(k).test(sp.match(/<a:lstStyle>([\s\S]*?)<\/a:lstStyle>/)?.[1] ?? "") ? sp : setLevelSizes(sp, new Map());
  return withLvl.replace(/<a:lstStyle>([\s\S]*?)<\/a:lstStyle>/, (_all, inner: string) => {
    let s = inner;
    if (!lvlRe(k).test(s)) s = s + `<a:lvl${k}pPr></a:lvl${k}pPr>`; // keep schema order: callers write lvl1 only
    const m = s.match(lvlRe(k))!;
    let attrs = m[1];
    let body = m[2] ?? "";
    const setAttr = (a: string, name: string, v: string) => (new RegExp(`\\s${name}="`).test(a) ? a.replace(new RegExp(`(\\s${name}=")[^"]*"`), `$1${v}"`) : `${a} ${name}="${v}"`);
    if (props.noBullet) {
      attrs = setAttr(setAttr(attrs, "marL", "0"), "indent", "0");
      if (BULLET_RE.test(body)) body = body.replace(BULLET_RE, "<a:buNone/>");
      else {
        const at = body.search(/<a:tabLst\b|<a:defRPr\b|<a:extLst\b/);
        body = at === -1 ? body + "<a:buNone/>" : body.slice(0, at) + "<a:buNone/>" + body.slice(at);
      }
    }
    if (props.algn) attrs = setAttr(attrs, "algn", props.algn);
    if (props.bold) {
      if (/<a:defRPr\b/.test(body)) body = body.replace(/<a:defRPr\b([^>]*?)(\/?)>/, (_d, a: string, c: string) => `<a:defRPr${setAttr(a, "b", "1")}${c}>`);
      else {
        const at = body.search(/<a:extLst\b/);
        body = at === -1 ? body + '<a:defRPr b="1"/>' : body.slice(0, at) + '<a:defRPr b="1"/>' + body.slice(at);
      }
    }
    return `<a:lstStyle>${s.slice(0, m.index!)}<a:lvl${k}pPr${attrs}>${body}</a:lvl${k}pPr>${s.slice(m.index! + m[0].length)}</a:lstStyle>`;
  });
}

/** 見本テキスト（`<a:p>` 内の rPr / endParaRPr）の sz を外す — lstStyle の値が効くように。 */
export function stripRunSizes(sp: string): string {
  return sp.replace(/<a:p>[\s\S]*?<\/a:p>|<a:p\b[^>]*>[\s\S]*?<\/a:p>/g, (p) =>
    p.replace(/(<a:(?:rPr|endParaRPr)\b[^>]*?)\s+sz="\d+"/g, "$1"),
  );
}
