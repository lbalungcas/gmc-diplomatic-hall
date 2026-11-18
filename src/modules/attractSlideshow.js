/**
 * Tablet / kiosk attract mode: after idleMs with no touch, loop a photo slideshow
 * until the visitor taps again. Desktop mouse halls leave this dormant.
 *
 * Photos live in public/attract/ (see manifest.json).
 */

const DEFAULT_IDLE_MS = 10000;
const DEFAULT_SLIDE_MS = 5500;

/**
 * @param {object} opts
 * @param {() => boolean} opts.isTouchDevice
 * @param {() => boolean} opts.hasStarted
 * @param {() => boolean} opts.isBlocked  true while welcome/pause/help or a modal is open
 * @param {(sel: string) => HTMLElement | null} opts.$
 */
export function createAttractSlideshow({ isTouchDevice, hasStarted, isBlocked, $ }) {
  const overlay = $('attract-slideshow');
  const imgA = $('attract-slide-a');
  const imgB = $('attract-slide-b');
  const hint = $('attract-hint');
  if (!overlay || !imgA || !imgB) {
    return { start() {}, stop() {}, bump() {}, dispose() {} };
  }

  let slides = [];
  let idleMs = DEFAULT_IDLE_MS;
  let slideMs = DEFAULT_SLIDE_MS;
  let idleTimer = null;
  let slideTimer = null;
  let index = 0;
  let showing = false;
  let frontIsA = true;
  let started = false;
  let disposed = false;

  async function loadManifest() {
    try {
      const res = await fetch('/attract/manifest.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (Array.isArray(data.slides) && data.slides.length) slides = data.slides.slice();
      if (Number.isFinite(Number(data.idleMs))) idleMs = Math.max(3000, Number(data.idleMs));
      if (Number.isFinite(Number(data.slideMs))) slideMs = Math.max(2000, Number(data.slideMs));
    } catch {
      slides = Array.from({ length: 17 }, (_, i) => `/attract/${String(i + 1).padStart(2, '0')}.jpg`);
    }
  }

  function clearIdle() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function clearSlide() {
    if (slideTimer) {
      clearInterval(slideTimer);
      slideTimer = null;
    }
  }

  function armIdle() {
    clearIdle();
    if (disposed || !started || !isTouchDevice() || !hasStarted() || isBlocked() || showing) return;
    if (!slides.length) return;
    idleTimer = setTimeout(show, idleMs);
  }

  function setSlide(i, { instant = false } = {}) {
    if (!slides.length) return;
    index = ((i % slides.length) + slides.length) % slides.length;
    const url = slides[index];
    const front = frontIsA ? imgA : imgB;
    const back = frontIsA ? imgB : imgA;

    const apply = () => {
      back.src = url;
      back.alt = `Event photo ${index + 1} of ${slides.length}`;
      if (instant) {
        front.classList.remove('is-front');
        back.classList.add('is-front');
        frontIsA = !frontIsA;
        return;
      }
      back.classList.add('is-front');
      front.classList.remove('is-front');
      frontIsA = !frontIsA;
    };

    if (back.complete && back.getAttribute('src') === url) {
      apply();
    } else {
      const onLoad = () => {
        back.removeEventListener('load', onLoad);
        apply();
      };
      back.addEventListener('load', onLoad);
      back.src = url;
    }

    // Warm the next image so fades stay smooth.
    const next = slides[(index + 1) % slides.length];
    if (next) {
      const warm = new Image();
      warm.src = next;
    }

    if (hint) hint.textContent = 'Tap anywhere to keep exploring';
  }

  function show() {
    if (disposed || !isTouchDevice() || !hasStarted() || isBlocked() || !slides.length) {
      armIdle();
      return;
    }
    showing = true;
    clearIdle();
    clearSlide();
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('attract-open');
    setSlide(index, { instant: true });
    slideTimer = setInterval(() => setSlide(index + 1), slideMs);
  }

  function hide() {
    if (!showing) return;
    showing = false;
    clearSlide();
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('attract-open');
  }

  function bump() {
    if (disposed || !started) return;
    hide();
    armIdle();
  }

  function onActivity(e) {
    if (!started || !isTouchDevice()) return;
    // Ignore pure mouse-move noise; tablets send pointer/touch/key.
    if (e && e.type === 'mousemove') return;
    bump();
  }

  const activityOpts = { capture: true, passive: true };
  const activityEvents = ['pointerdown', 'touchstart', 'keydown', 'wheel'];

  async function start() {
    if (disposed || started) return;
    started = true;
    await loadManifest();
    for (const ev of activityEvents) window.addEventListener(ev, onActivity, activityOpts);
    // Joystick / HUD taps bubble as pointerdown; also re-arm when overlays close.
    armIdle();
  }

  function stop() {
    started = false;
    hide();
    clearIdle();
    clearSlide();
    for (const ev of activityEvents) window.removeEventListener(ev, onActivity, activityOpts);
  }

  function dispose() {
    disposed = true;
    stop();
  }

  return {
    start,
    stop,
    /** Call after closing a modal / blocker so the idle clock restarts. */
    bump,
    /** True while the photo loop covers the hall. */
    get active() { return showing; },
    dispose,
  };
}
