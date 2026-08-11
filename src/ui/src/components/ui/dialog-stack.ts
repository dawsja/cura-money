import { useId, useLayoutEffect, useSyncExternalStore } from 'react';

type LayerKind = 'dialog' | 'popover';

interface Layer {
  id: string;
  kind: LayerKind;
}

let layers: Layer[] = [];
const listeners = new Set<() => void>();
let originalMainOverflow: string | undefined;
let originalRootInert: boolean | undefined;

function emit() {
  for (const listener of listeners) listener();
}

function syncPageState() {
  const hasDialog = layers.some((layer) => layer.kind === 'dialog');
  const appRoot = document.getElementById('root');
  const appMain = document.getElementById('app-main');

  if (hasDialog && appRoot) {
    if (originalRootInert === undefined) originalRootInert = appRoot.inert;
    appRoot.inert = true;
  } else if (appRoot && originalRootInert !== undefined) {
    appRoot.inert = originalRootInert;
    originalRootInert = undefined;
  }
  if (hasDialog && appMain) {
    if (originalMainOverflow === undefined) originalMainOverflow = appMain.style.overflow;
    appMain.style.overflow = 'hidden';
  } else if (appMain && originalMainOverflow !== undefined) {
    appMain.style.overflow = originalMainOverflow;
    originalMainOverflow = undefined;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return layers;
}

export function useDialogLayer(kind: LayerKind = 'dialog', enabled = true) {
  const id = useId();
  const currentLayers = useSyncExternalStore(subscribe, snapshot, snapshot);

  useLayoutEffect(() => {
    if (!enabled) return;
    layers = [...layers, { id, kind }];
    syncPageState();
    emit();
    return () => {
      layers = layers.filter((layer) => layer.id !== id);
      syncPageState();
      emit();
    };
  }, [enabled, id, kind]);

  const index = currentLayers.findIndex((layer) => layer.id === id);
  const hasDialogAbove = index >= 0
    && currentLayers.slice(index + 1).some((layer) => layer.kind === 'dialog');
  return {
    isTopLayer: enabled && currentLayers.at(-1)?.id === id,
    isTopDialog: enabled && (index < 0 || !hasDialogAbove),
    zIndex: 1000 + Math.max(index, 0) * 10,
  };
}
