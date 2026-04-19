/**
 * stores/useUIStore.ts
 * Navigation, modal state, toast queue, import flow step.
 * All ephemeral UI state that doesn't need to persist across sessions.
 */

"use client";

import { create } from "zustand";

export type Tab = "log" | "dashboard" | "settings";
export type ModalType =
  | "punchIn"
  | "logEntry"
  | "jobEdit"
  | "holidayEntry"
  | null;

export interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  message: string;
  duration?: number; // ms, default 4000
}

export type ImportStep =
  | "upload"
  | "columnMap"
  | "validation"
  | "preview"
  | null;

interface UIState {
  activeTab: Tab;
  activeModal: ModalType;
  modalData: Record<string, unknown> | null;
  toasts: Toast[];
  importStep: ImportStep;
  storageDurabilityWarning: boolean;

  // Tab navigation
  setTab: (tab: Tab) => void;

  // Modal management
  openModal: (modal: ModalType, data?: Record<string, unknown>) => void;
  closeModal: () => void;

  // Toast system
  addToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  // Import flow
  setImportStep: (step: ImportStep) => void;

  // Warnings
  setStorageDurabilityWarning: (show: boolean) => void;
}

let toastIdCounter = 0;

export const useUIStore = create<UIState>((set, get) => ({
  activeTab: "log",
  activeModal: null,
  modalData: null,
  toasts: [],
  importStep: null,
  storageDurabilityWarning: false,

  setTab: (tab) => set({ activeTab: tab }),

  openModal: (modal, data: any = null) => set({ activeModal: modal, modalData: data }),
  closeModal: () => set({ activeModal: null, modalData: null }),

  addToast: (toast) => {
    const id = `toast_${++toastIdCounter}`;
    const duration = toast.duration ?? 4000;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    // Auto-dismiss
    setTimeout(() => get().dismissToast(id), duration);
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setImportStep: (step) => set({ importStep: step }),
  setStorageDurabilityWarning: (show) => set({ storageDurabilityWarning: show }),
}));
