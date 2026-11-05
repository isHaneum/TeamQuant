// ⓘ 설명 툴팁: 긴 설명을 화면에 늘어놓지 않고, 아이콘에 마우스를 올리거나(키보드 포커스·터치 포함) 할 때만 띄운다.
// 카드의 overflow에 잘리지 않도록 body에 붙인 하나의 말풍선을 위치만 옮겨 쓴다.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const tip = (text, label = '설명') => text ? `<button type="button" class="tip" data-tip="${esc(text)}" aria-label="${esc(label)}: ${esc(text)}">i</button>` : '';

const css = document.createElement('style');
css.textContent = `.tip{display:inline-grid;place-items:center;width:16px;height:16px;margin-left:6px;padding:0;border:1px solid #c4cad4;border-radius:50%;background:#fff;color:#6b7280;font:italic 600 10px/1 Georgia,serif;cursor:help;vertical-align:1px;flex:none}
.tip:hover,.tip:focus-visible,.tip[aria-expanded="true"]{border-color:#14171c;color:#14171c;outline:none}
.tip-bubble{position:fixed;z-index:1000;max-width:300px;padding:9px 12px;border-radius:10px;background:#14171c;color:#fff;font:400 12.5px/1.6 var(--font-ui,sans-serif);box-shadow:0 10px 30px rgba(0,0,0,.18);pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s;white-space:pre-line}
.tip-bubble.on{opacity:1;transform:none}`;
document.head.append(css);
const bubble = document.createElement('div'); bubble.className = 'tip-bubble'; bubble.setAttribute('role', 'tooltip'); bubble.id = 'tip-bubble';
document.addEventListener('DOMContentLoaded', () => document.body.append(bubble)); if (document.body) document.body.append(bubble);
let owner = null;
function show(el) {
  owner = el; bubble.textContent = el.dataset.tip; el.setAttribute('aria-expanded', 'true'); el.setAttribute('aria-describedby', 'tip-bubble');
  // 열린 <dialog>는 최상위 레이어라 그 안에 붙여야 보인다.
  const host = el.closest('dialog[open]') || document.body; if (bubble.parentElement !== host) host.append(bubble);
  bubble.classList.add('on');
  const r = el.getBoundingClientRect(), b = bubble.getBoundingClientRect(), gap = 8;
  let top = r.top - b.height - gap; if (top < 8) top = r.bottom + gap;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - b.width / 2), innerWidth - b.width - 8);
  bubble.style.top = `${top}px`; bubble.style.left = `${left}px`;
}
function hide() { if (owner) { owner.setAttribute('aria-expanded', 'false'); owner.removeAttribute('aria-describedby'); } owner = null; bubble.classList.remove('on'); }
document.addEventListener('mouseover', e => { const t = e.target.closest?.('.tip'); if (t) show(t); });
document.addEventListener('mouseout', e => { if (e.target.closest?.('.tip') && !e.relatedTarget?.closest?.('.tip')) hide(); });
document.addEventListener('focusin', e => { const t = e.target.closest?.('.tip'); if (t) show(t); });
document.addEventListener('focusout', e => { if (e.target.closest?.('.tip')) hide(); });
document.addEventListener('click', e => { const t = e.target.closest?.('.tip'); if (t) { e.preventDefault(); e.stopPropagation(); owner === t ? hide() : show(t); } else hide(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
addEventListener('scroll', hide, true);
