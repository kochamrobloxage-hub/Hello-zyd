(function () {
  const metro = vendetta.metro;
  const find = metro.find;
  const findByStoreName = metro.findByStoreName;
  const FluxDispatcher = metro.common && metro.common.FluxDispatcher;
  const showToast = vendetta.ui.toasts.showToast;

  const SHOW_TOAST = true; // false = bez powiadomień
  const MIN_MS = 179000;   // zapasowa blokada timera ~3 min
  const MAX_MS = 181000;

  const origSetTimeout = globalThis.setTimeout;
  const noop = function () {};
  const unpatches = [];
  let handlerPatched = false;

  function toast(msg) {
    if (!SHOW_TOAST) return;
    try { showToast(msg); } catch (e) {}
  }

  // true, jeśli jesteś teraz na rozmowie w DM (1) lub grupie DM (3)
  function inPrivateCall() {
    try {
      const vcId = findByStoreName("SelectedChannelStore").getVoiceChannelId();
      if (!vcId) return false;
      const ch = findByStoreName("ChannelStore").getChannel(vcId);
      return !!ch && (ch.type === 1 || ch.type === 3);
    } catch (e) {
      return false;
    }
  }

  // --- Metoda 1: to samo co Vencord DisableCallIdle (handler idle rozmowy) ---
  function isIdleHandler(m) {
    try {
      return (
        !!m &&
        (typeof m.handleIdleUpdate === "function" ||
          (!!m.prototype && typeof m.prototype.handleIdleUpdate === "function"))
      );
    } catch (e) {
      return false;
    }
  }

  function tryPatchHandler(quiet) {
    if (handlerPatched) return;
    let target;
    try { target = find(isIdleHandler); } catch (e) { return; }
    if (!target) return;
    const parent = typeof target.handleIdleUpdate === "function" ? target : target.prototype;
    try {
      unpatches.push(vendetta.patcher.instead("handleIdleUpdate", parent, noop));
      handlerPatched = true;
      if (!quiet) toast("NoCallAfk: handler idle zablokowany");
    } catch (e) {}
  }

  function onVoiceEvent() {
    if (handlerPatched) return;
    tryPatchHandler(false);
    origSetTimeout(function () { tryPatchHandler(false); }, 1500);
  }

  // --- Metoda 2 (zapasowa): neutralizacja timera ~3 min w rozmowie DM ---
  function patchedSetTimeout(fn, ms) {
    if (
      typeof fn === "function" &&
      typeof ms === "number" &&
      ms >= MIN_MS &&
      ms <= MAX_MS &&
      inPrivateCall()
    ) {
      toast("NoCallAfk: zablokowano auto-rozłączenie");
      return origSetTimeout.call(this, noop, ms);
    }
    return origSetTimeout.apply(this, arguments);
  }

  return {
    onLoad() {
      globalThis.setTimeout = patchedSetTimeout;
      tryPatchHandler(true);
      if (FluxDispatcher) {
        try { FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onVoiceEvent); } catch (e) {}
      }
      toast(
        handlerPatched
          ? "NoCallAfk: aktywny (handler + timer)"
          : "NoCallAfk: aktywny (tylko timer)"
      );
    },
    onUnload() {
      if (globalThis.setTimeout === patchedSetTimeout) {
        globalThis.setTimeout = origSetTimeout;
      }
      if (FluxDispatcher) {
        try { FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onVoiceEvent); } catch (e) {}
      }
      while (unpatches.length) {
        try { unpatches.pop()(); } catch (e) {}
      }
      handlerPatched = false;
    },
  };
})()
