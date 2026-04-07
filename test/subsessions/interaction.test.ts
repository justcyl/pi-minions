import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InteractionRequest, InteractionResponse } from "../../src/subsessions/event-bus.js";
import {
  EventBus,
  MINION_INTERACTION_REQUEST,
  MINION_INTERACTION_RESPONSE,
} from "../../src/subsessions/event-bus.js";
import {
  createInteractionHandler,
  createMinionUIContext,
} from "../../src/subsessions/interaction.js";

/** Default interaction timeout matching config.ts default (60s in ms) */
const DEFAULT_TIMEOUT = 60_000;

describe("createMinionUIContext — proxy forwarding", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    eventBus.removeAllListeners();
  });

  /** Helper: simulate a parent responding to an interaction request */
  function simulateResponse(value: unknown, cancelled = false): void {
    eventBus.on<InteractionRequest>(MINION_INTERACTION_REQUEST, (req) => {
      eventBus.emit<InteractionResponse>(MINION_INTERACTION_RESPONSE, {
        requestId: req.requestId,
        value,
        cancelled,
      });
    });
  }

  it("confirm() emits request and resolves with parent's boolean", async () => {
    simulateResponse(true);
    const proxy = createMinionUIContext(eventBus, "m1", "alice", DEFAULT_TIMEOUT);
    const result = proxy.confirm("Allow?", "rm -rf");
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe(true);
  });

  it("select() emits request with options and resolves with chosen value", async () => {
    simulateResponse("B");
    const proxy = createMinionUIContext(eventBus, "m1", "alice", DEFAULT_TIMEOUT);
    const result = proxy.select("Pick", ["A", "B"]);
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe("B");
  });

  it("input() emits request and resolves with user text", async () => {
    simulateResponse("foo");
    const proxy = createMinionUIContext(eventBus, "m1", "alice", DEFAULT_TIMEOUT);
    const result = proxy.input("Name?");
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe("foo");
  });

  it("editor() emits request and resolves with edited text", async () => {
    simulateResponse("final");
    const proxy = createMinionUIContext(eventBus, "m1", "alice", DEFAULT_TIMEOUT);
    const result = proxy.editor("Edit", "draft");
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe("final");
  });

  it("confirm() returns false when no response arrives within timeout", async () => {
    // No response simulated — will timeout
    const proxy = createMinionUIContext(eventBus, "m1", "alice", DEFAULT_TIMEOUT);
    const result = proxy.confirm("Allow?", "dangerous");
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT + 100);
    await expect(result).resolves.toBe(false);
  });

  it("select() returns undefined on timeout", async () => {
    const proxy = createMinionUIContext(eventBus, "m1", "alice", DEFAULT_TIMEOUT);
    const result = proxy.select("Pick", ["A", "B"]);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT + 100);
    await expect(result).resolves.toBeUndefined();
  });

  it("confirm() returns false when response is cancelled", async () => {
    simulateResponse(undefined, true);
    const proxy = createMinionUIContext(eventBus, "m1", "alice", DEFAULT_TIMEOUT);
    const result = proxy.confirm("Allow?", "something");
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe(false);
  });

  it("custom() returns undefined without emitting any request", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    const proxy = createMinionUIContext(eventBus, "m1", "alice", DEFAULT_TIMEOUT);
    // custom() is a no-op on the proxy, so the factory is irrelevant
    const result = await proxy.custom((() => ({})) as any);
    expect(result).toBeUndefined();
    expect(emitSpy).not.toHaveBeenCalledWith(MINION_INTERACTION_REQUEST, expect.anything());
  });

  it("passive methods do not emit and do not throw", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    const proxy = createMinionUIContext(eventBus, "m1", "alice", DEFAULT_TIMEOUT);

    expect(() => proxy.notify("hello")).not.toThrow();
    expect(() => proxy.setStatus("key", "val")).not.toThrow();
    expect(() => proxy.setWidget("key", undefined)).not.toThrow();

    // None of those should have emitted an interaction request
    const interactionCalls = emitSpy.mock.calls.filter(
      ([channel]) => channel === MINION_INTERACTION_REQUEST,
    );
    expect(interactionCalls).toHaveLength(0);
  });

  it("request contains correct minionId and minionName from closure", async () => {
    let capturedRequest: InteractionRequest | undefined;
    eventBus.on<InteractionRequest>(MINION_INTERACTION_REQUEST, (req) => {
      capturedRequest = req;
      // Respond so confirm resolves
      eventBus.emit<InteractionResponse>(MINION_INTERACTION_RESPONSE, {
        requestId: req.requestId,
        value: true,
        cancelled: false,
      });
    });

    const proxy = createMinionUIContext(eventBus, "m1", "alice", DEFAULT_TIMEOUT);
    const result = proxy.confirm("Allow?", "something");
    await vi.advanceTimersByTimeAsync(0);
    await result;

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest!.minionId).toBe("m1");
    expect(capturedRequest!.minionName).toBe("alice");
  });
});

describe("createInteractionHandler — parent-side forwarding", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  afterEach(() => {
    eventBus.removeAllListeners();
  });

  function mockParentUi() {
    return {
      confirm: vi.fn().mockResolvedValue(true),
      select: vi.fn().mockResolvedValue("B"),
      input: vi.fn().mockResolvedValue("typed"),
      editor: vi.fn().mockResolvedValue("edited"),
    };
  }

  function emitRequest(overrides: Partial<InteractionRequest> = {}): InteractionRequest {
    const req: InteractionRequest = {
      requestId: "req-1",
      minionId: "m1",
      minionName: "alice",
      type: "confirm",
      title: "Allow?",
      ...overrides,
    };
    eventBus.emit<InteractionRequest>(MINION_INTERACTION_REQUEST, req);
    return req;
  }

  it("calls parent ui.confirm when request type is confirm", async () => {
    const ui = mockParentUi();
    createInteractionHandler(eventBus, () => ui as any);

    const responses: InteractionResponse[] = [];
    eventBus.on<InteractionResponse>(MINION_INTERACTION_RESPONSE, (r) => responses.push(r));

    emitRequest({ type: "confirm", title: "Allow?", message: "rm -rf" });
    await vi.waitFor(() => expect(responses).toHaveLength(1));

    expect(ui.confirm).toHaveBeenCalledWith("[alice] Allow?", "rm -rf");
    expect(responses[0].value).toBe(true);
    expect(responses[0].cancelled).toBe(false);
  });

  it("calls parent ui.select when request type is select", async () => {
    const ui = mockParentUi();
    createInteractionHandler(eventBus, () => ui as any);

    const responses: InteractionResponse[] = [];
    eventBus.on<InteractionResponse>(MINION_INTERACTION_RESPONSE, (r) => responses.push(r));

    emitRequest({ type: "select", title: "Pick", options: ["A", "B"] });
    await vi.waitFor(() => expect(responses).toHaveLength(1));

    expect(ui.select).toHaveBeenCalledWith("[alice] Pick", ["A", "B"]);
    expect(responses[0].value).toBe("B");
  });

  it("calls parent ui.input when request type is input", async () => {
    const ui = mockParentUi();
    createInteractionHandler(eventBus, () => ui as any);

    const responses: InteractionResponse[] = [];
    eventBus.on<InteractionResponse>(MINION_INTERACTION_RESPONSE, (r) => responses.push(r));

    emitRequest({ type: "input", title: "Name?", message: "placeholder" });
    await vi.waitFor(() => expect(responses).toHaveLength(1));

    expect(ui.input).toHaveBeenCalledWith("[alice] Name?", "placeholder");
    expect(responses[0].value).toBe("typed");
  });

  it("calls parent ui.editor when request type is editor", async () => {
    const ui = mockParentUi();
    createInteractionHandler(eventBus, () => ui as any);

    const responses: InteractionResponse[] = [];
    eventBus.on<InteractionResponse>(MINION_INTERACTION_RESPONSE, (r) => responses.push(r));

    emitRequest({ type: "editor", title: "Edit", message: "prefill" });
    await vi.waitFor(() => expect(responses).toHaveLength(1));

    expect(ui.editor).toHaveBeenCalledWith("[alice] Edit", "prefill");
    expect(responses[0].value).toBe("edited");
  });

  it("emits cancelled response when parent UI is null", async () => {
    createInteractionHandler(eventBus, () => null);

    const responses: InteractionResponse[] = [];
    eventBus.on<InteractionResponse>(MINION_INTERACTION_RESPONSE, (r) => responses.push(r));

    emitRequest();
    await vi.waitFor(() => expect(responses).toHaveLength(1));

    expect(responses[0].cancelled).toBe(true);
  });

  it("emits cancelled response when parent UI throws", async () => {
    const ui = mockParentUi();
    ui.confirm.mockRejectedValue(new Error("UI crashed"));
    createInteractionHandler(eventBus, () => ui as any);

    const responses: InteractionResponse[] = [];
    eventBus.on<InteractionResponse>(MINION_INTERACTION_RESPONSE, (r) => responses.push(r));

    emitRequest({ type: "confirm" });
    await vi.waitFor(() => expect(responses).toHaveLength(1));

    expect(responses[0].cancelled).toBe(true);
  });

  it("handles concurrent requests from different minions", async () => {
    const ui = mockParentUi();
    ui.confirm.mockResolvedValue(true);
    ui.input.mockResolvedValue("answer");
    createInteractionHandler(eventBus, () => ui as any);

    const responses: InteractionResponse[] = [];
    eventBus.on<InteractionResponse>(MINION_INTERACTION_RESPONSE, (r) => responses.push(r));

    emitRequest({
      requestId: "r1",
      minionId: "m1",
      minionName: "alice",
      type: "confirm",
      title: "Q1",
    });
    emitRequest({ requestId: "r2", minionId: "m2", minionName: "bob", type: "input", title: "Q2" });

    await vi.waitFor(() => expect(responses).toHaveLength(2));

    const r1 = responses.find((r) => r.requestId === "r1");
    const r2 = responses.find((r) => r.requestId === "r2");
    expect(r1?.value).toBe(true);
    expect(r2?.value).toBe("answer");
  });

  it("serializes concurrent requests so only one ui call is active at a time", async () => {
    // Track when each ui.confirm starts and ends to prove serialization
    const callLog: string[] = [];
    let resolveFirst: ((v: boolean) => void) | undefined;
    let resolveSecond: ((v: boolean) => void) | undefined;

    const ui = mockParentUi();
    ui.confirm
      .mockImplementationOnce(() => {
        callLog.push("first:start");
        return new Promise<boolean>((r) => {
          resolveFirst = (v) => {
            callLog.push("first:end");
            r(v);
          };
        });
      })
      .mockImplementationOnce(() => {
        callLog.push("second:start");
        return new Promise<boolean>((r) => {
          resolveSecond = (v) => {
            callLog.push("second:end");
            r(v);
          };
        });
      });

    createInteractionHandler(eventBus, () => ui as any);

    const responses: InteractionResponse[] = [];
    eventBus.on<InteractionResponse>(MINION_INTERACTION_RESPONSE, (r) => responses.push(r));

    // Emit two requests "simultaneously"
    emitRequest({ requestId: "r1", type: "confirm", title: "Q1" });
    emitRequest({ requestId: "r2", type: "confirm", title: "Q2" });

    // Let microtasks flush so the first request starts processing
    await new Promise((r) => setTimeout(r, 10));

    // Only the first should have started — second must be queued
    expect(callLog).toEqual(["first:start"]);
    expect(resolveFirst).toBeDefined();
    expect(resolveSecond).toBeUndefined();

    // Complete the first request
    resolveFirst!(true);
    await new Promise((r) => setTimeout(r, 10));

    // Now the second should have started
    expect(callLog).toEqual(["first:start", "first:end", "second:start"]);
    expect(responses).toHaveLength(1);
    expect(responses[0].requestId).toBe("r1");

    // Complete the second
    resolveSecond!(false);
    await new Promise((r) => setTimeout(r, 10));

    expect(callLog).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    expect(responses).toHaveLength(2);
    expect(responses[1].requestId).toBe("r2");
  });

  it("continues processing queue when a request errors", async () => {
    const ui = mockParentUi();
    ui.confirm.mockRejectedValueOnce(new Error("UI crashed")).mockResolvedValueOnce(true);

    createInteractionHandler(eventBus, () => ui as any);

    const responses: InteractionResponse[] = [];
    eventBus.on<InteractionResponse>(MINION_INTERACTION_RESPONSE, (r) => responses.push(r));

    emitRequest({ requestId: "r1", type: "confirm", title: "Q1" });
    emitRequest({ requestId: "r2", type: "confirm", title: "Q2" });

    await vi.waitFor(() => expect(responses).toHaveLength(2));

    // First errored → cancelled, second succeeded
    expect(responses.find((r) => r.requestId === "r1")?.cancelled).toBe(true);
    expect(responses.find((r) => r.requestId === "r2")?.cancelled).toBe(false);
    expect(responses.find((r) => r.requestId === "r2")?.value).toBe(true);
  });

  it("prefixes title with minion name", async () => {
    const ui = mockParentUi();
    createInteractionHandler(eventBus, () => ui as any);

    const responses: InteractionResponse[] = [];
    eventBus.on<InteractionResponse>(MINION_INTERACTION_RESPONSE, (r) => responses.push(r));

    emitRequest({ minionName: "bob", type: "confirm", title: "Proceed?" });
    await vi.waitFor(() => expect(responses).toHaveLength(1));

    expect(ui.confirm).toHaveBeenCalledWith("[bob] Proceed?", expect.any(String));
  });
});

describe("interaction round-trip — proxy + handler over shared EventBus", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    eventBus.removeAllListeners();
  });

  it("confirm flows from proxy through handler to parent UI and back", async () => {
    const parentUi = {
      confirm: vi.fn().mockResolvedValue(true),
      select: vi.fn(),
      input: vi.fn(),
      editor: vi.fn(),
    };

    // Wire handler on parent side
    createInteractionHandler(eventBus, () => parentUi as any);

    // Create proxy on minion side
    const proxy = createMinionUIContext(eventBus, "m1", "alice", DEFAULT_TIMEOUT);

    const result = proxy.confirm("Allow?", "rm -rf");
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe(true);
  });

  it("select flows end-to-end with correct options", async () => {
    const parentUi = {
      confirm: vi.fn(),
      select: vi.fn().mockResolvedValue("B"),
      input: vi.fn(),
      editor: vi.fn(),
    };

    createInteractionHandler(eventBus, () => parentUi as any);
    const proxy = createMinionUIContext(eventBus, "m1", "alice", DEFAULT_TIMEOUT);

    const result = proxy.select("Pick", ["A", "B"]);
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe("B");
  });

  it("timeout fires when handler is not wired", async () => {
    // Create proxy only (no handler wired)
    const proxy = createMinionUIContext(eventBus, "m1", "alice", DEFAULT_TIMEOUT);

    const result = proxy.confirm("Allow?", "something");
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT + 100);
    await expect(result).resolves.toBe(false);
  });

  it("uses custom timeout when provided", async () => {
    const customTimeout = 5_000;
    const proxy = createMinionUIContext(eventBus, "m1", "alice", customTimeout);

    const result = proxy.confirm("Allow?", "test");

    // Should NOT have timed out yet at 4.9s
    await vi.advanceTimersByTimeAsync(customTimeout - 100);
    // Confirm is still pending — advance past the custom timeout
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toBe(false);
  });
});
