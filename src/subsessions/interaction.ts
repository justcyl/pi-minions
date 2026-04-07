import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import { generateId } from "../minions.js";
import type { EventBus, InteractionRequest, InteractionResponse } from "./event-bus.js";
import { MINION_INTERACTION_REQUEST, MINION_INTERACTION_RESPONSE } from "./event-bus.js";

type InteractionType = InteractionRequest["type"];

function timeoutDefault(type: InteractionType): unknown {
  switch (type) {
    case "confirm":
      return false;
    case "select":
    case "input":
    case "editor":
      return undefined;
  }
}

function forwardToParent(
  eventBus: EventBus,
  minionId: string,
  minionName: string,
  type: InteractionType,
  title: string,
  timeout: number,
  message?: string,
  options?: string[],
): Promise<unknown> {
  return new Promise((resolve) => {
    const requestId = generateId();
    let settled = false;

    const unsubscribe = eventBus.on<InteractionResponse>(MINION_INTERACTION_RESPONSE, (resp) => {
      if (resp.requestId !== requestId) return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (resp.cancelled) {
        resolve(timeoutDefault(type));
      } else {
        resolve(resp.value);
      }
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(timeoutDefault(type));
    }, timeout);

    eventBus.emit<InteractionRequest>(MINION_INTERACTION_REQUEST, {
      requestId,
      minionId,
      minionName,
      type,
      title,
      message,
      options,
    });
  });
}

export function createMinionUIContext(
  eventBus: EventBus,
  minionId: string,
  minionName: string,
  timeout: number,
): ExtensionUIContext {
  const ctx: ExtensionUIContext = {
    confirm(title: string, message: string): Promise<boolean> {
      return forwardToParent(
        eventBus,
        minionId,
        minionName,
        "confirm",
        title,
        timeout,
        message,
      ) as Promise<boolean>;
    },
    select(title: string, options: string[]): Promise<string | undefined> {
      return forwardToParent(
        eventBus,
        minionId,
        minionName,
        "select",
        title,
        timeout,
        undefined,
        options,
      ) as Promise<string | undefined>;
    },
    input(title: string, placeholder?: string): Promise<string | undefined> {
      return forwardToParent(
        eventBus,
        minionId,
        minionName,
        "input",
        title,
        timeout,
        placeholder,
      ) as Promise<string | undefined>;
    },
    editor(title: string, prefill?: string): Promise<string | undefined> {
      return forwardToParent(
        eventBus,
        minionId,
        minionName,
        "editor",
        title,
        timeout,
        prefill,
      ) as Promise<string | undefined>;
    },
    custom<T>(): Promise<T> {
      return Promise.resolve(undefined as T);
    },
    // Passive no-ops — fire-and-forget, no interaction needed
    notify() {},
    onTerminalInput() {
      return () => {};
    },
    setStatus() {},
    setWorkingMessage() {},
    setWidget() {},
    setFooter() {},
    setHeader() {},
    setTitle() {},
    pasteToEditor() {},
    setEditorText() {},
    getEditorText() {
      return "";
    },
    setEditorComponent() {},
    get theme() {
      // Return a minimal stub — minion proxy never renders UI
      return {} as ExtensionUIContext["theme"];
    },
    getAllThemes() {
      return [];
    },
    getTheme() {
      return undefined;
    },
    setTheme() {
      return { success: false };
    },
    getToolsExpanded() {
      return false;
    },
    setToolsExpanded() {},
  };
  return ctx;
}

export function createInteractionHandler(
  eventBus: EventBus,
  getUi: () => ExtensionUIContext | null,
): () => void {
  const queue: InteractionRequest[] = [];
  let processing = false;

  async function processNext(): Promise<void> {
    if (processing || queue.length === 0) return;
    processing = true;

    const req = queue.shift();
    if (!req) return;
    try {
      const ui = getUi();
      if (!ui) {
        eventBus.emit<InteractionResponse>(MINION_INTERACTION_RESPONSE, {
          requestId: req.requestId,
          value: undefined,
          cancelled: true,
        });
        return;
      }

      let value: unknown;
      const prefixedTitle = `[${req.minionName}] ${req.title}`;
      switch (req.type) {
        case "confirm":
          value = await ui.confirm(prefixedTitle, req.message ?? "");
          break;
        case "select":
          value = await ui.select(prefixedTitle, req.options ?? []);
          break;
        case "input":
          value = await ui.input(prefixedTitle, req.message);
          break;
        case "editor":
          value = await ui.editor(prefixedTitle, req.message);
          break;
      }
      eventBus.emit<InteractionResponse>(MINION_INTERACTION_RESPONSE, {
        requestId: req.requestId,
        value,
        cancelled: false,
      });
    } catch {
      eventBus.emit<InteractionResponse>(MINION_INTERACTION_RESPONSE, {
        requestId: req.requestId,
        value: undefined,
        cancelled: true,
      });
    } finally {
      processing = false;
      processNext();
    }
  }

  const unsubscribe = eventBus.on<InteractionRequest>(MINION_INTERACTION_REQUEST, (req) => {
    queue.push(req);
    processNext();
  });

  return unsubscribe;
}
