// ⓘ 설명 툴팁: 긴 설명을 화면에 늘어놓지 않고 ⓘ 로 연다(2026-11-26 손봄 · 휴대폰에서 누르면 열렸다 바로 닫히던 문제).
// - 터치·클릭: 누르면 열리고 그대로 남는다. 다시 누르거나, 바깥을 누르거나, Esc·스크롤이면 닫힌다.
// - 마우스: 올리면 열리고 떠나면 닫힌다(누른 것은 남는다).
// - 키보드: 포커스가 가면 열리고, 포커스가 다른 곳으로 가거나 Esc 면 닫힌다. Enter·Space 는 누르기와 같다.
// 보이는 원은 16px, 누르는 면적은 ::after 로 24px. 카드의 overflow 에 잘리지 않도록 body 에 붙인 말풍선 하나를 위치만 옮겨 쓴다.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const tip = (text, label = '설명') => text ? `<button type="button" class="tip" data-tip="${esc(text)}" aria-label="${esc(label)}: ${esc(text)}" aria-expanded="false">i</button>` : '';

const css = document.createElement('style');
css.textContent = `.tip{position:relative;display:inline-grid;place-items:center;width:16px;height:16px;margin-left:6px;padding:0;border:1px solid var(--tq-line);border-radius:50%;background:var(--tq-paper);color:var(--tq-faint);font:italic 600 10px/1 Georgia,serif;cursor:help;vertical-align:1px;flex:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.tip::after{content:'';position:absolute;inset:-4px;border-radius:50%}
.tip:hover,.tip:focus-visible,.tip[aria-expanded="true"]{border-color:var(--tq-ink);color:var(--tq-ink);outline:none}
.tip:focus-visible{box-shadow:0 0 0 2px var(--tq-accent)}
.tip-bubble{position:fixed;z-index:1000;max-width:min(320px,calc(100vw - 16px));padding:var(--tq-sp-2) var(--tq-sp-3);border-radius:var(--tq-r-1);background:var(--tq-ink);color:var(--tq-paper);font:400 var(--tq-fs-2)/1.6 var(--font-ui,sans-serif);box-shadow:0 10px 30px rgba(0,0,0,.18);pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s;white-space:pre-line;overflow-wrap:anywhere}
.tip-bubble.on{opacity:1;transform:none}`;
document.head.append(css);
const bubble = document.createElement('div'); bubble.className = 'tip-bubble'; bubble.setAttribute('role', 'tooltip'); bubble.id = 'tip-bubble';
const mount = () => { if (!bubble.isConnected && document.body) document.body.append(bubble); };
document.addEventListener('DOMContentLoaded', mount); mount();

let owner = null, pinned = false, pressing = false;
const tipOf = e => e.target?.closest?.('.tip') || null;
function show(el, { pin = false } = {}) {
  const same = owner === el; if (owner && !same) hide();
  owner = el; pinned = pin || (same && pinned);
  bubble.textContent = el.dataset.tip || '';
  el.setAttribute('aria-expanded', 'true'); el.setAttribute('aria-describedby', 'tip-bubble');
  // 열린 <dialog>는 최상위 레이어라 그 안에 붙여야 보인다.
  const host = el.closest('dialog[open]') || document.body; if (bubble.parentElement !== host) host.append(bubble);
  bubble.classList.add('on');
  const r = el.getBoundingClientRect(), b = bubble.getBoundingClientRect(), gap = 8;
  let top = r.top - b.height - gap; if (top < 8) top = r.bottom + gap;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - b.width / 2, innerWidth - b.width - 8));
  bubble.style.top = `${top}px`; bubble.style.left = `${left}px`;
}
function hide() { if (owner) { owner.setAttribute('aria-expanded', 'false'); owner.removeAttribute('aria-describedby'); } owner = null; pinned = false; bubble.classList.remove('on'); }

// 마우스만 올리기로 연다. 터치는 누를 때 연다(터치가 만드는 가짜 mouseover 로 열린 뒤 click 으로 바로 닫히던 원인).
if (window.PointerEvent) {
  document.addEventListener('pointerover', e => { if (e.pointerType !== 'mouse') return; const t = tipOf(e); if (t && !(pinned && owner && owner !== t)) show(t); });
  document.addEventListener('pointerout', e => { if (e.pointerType !== 'mouse') return; const t = tipOf(e); if (!t || t !== owner || pinned || e.relatedTarget?.closest?.('.tip') === t) return; hide(); });
} else {
  document.addEventListener('mouseover', e => { const t = tipOf(e); if (t && !pinned) show(t); });
  document.addEventListener('mouseout', e => { const t = tipOf(e); if (t && t === owner && !pinned && e.relatedTarget?.closest?.('.tip') !== t) hide(); });
}
// 바깥을 누르면 닫는다. click 이 아니라 pointerdown 으로 본다: iOS 사파리는 누를 수 없는 곳의 click 을 문서까지 보내지 않는다.
document.addEventListener('pointerdown', e => { const t = tipOf(e); pressing = !!t; if (!t && owner) hide(); }, true);
// 키보드 포커스로 연다. 누르기(포인터)로 생긴 포커스는 click 이 맡는다.
document.addEventListener('focusin', e => { const t = tipOf(e); if (t && !pressing) show(t); });
document.addEventListener('focusout', e => { const t = tipOf(e); if (t && t === owner && e.relatedTarget && e.relatedTarget.closest?.('.tip') !== t) hide(); });
// 누르기(터치·클릭·Enter·Space): 닫혀 있거나 올리기·포커스로만 열려 있으면 고정해서 열고, 고정돼 있으면 닫는다.
// 접힘 제목(summary)·라벨 안의 ⓘ 를 눌러도 접힘이 열리거나 입력칸이 선택되지 않게 기본 동작을 막는다.
document.addEventListener('click', e => { const t = tipOf(e); pressing = false; if (!t) return; e.preventDefault(); e.stopPropagation(); if (owner === t && pinned) hide(); else show(t, { pin: true }); }, true);
document.addEventListener('keydown', e => { pressing = false; if (e.key === 'Escape' && owner) hide(); });
addEventListener('scroll', () => { if (owner) hide(); }, true);
addEventListener('resize', () => { if (owner) hide(); });
