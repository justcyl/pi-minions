import { bench, describe } from "vitest";
import { EventBus } from "../../src/subsessions/event-bus.js";
import {
  createInteractionHandler,
  createMinionUIContext,
} from "../../src/subsessions/interaction.js";

describe("Interaction proxy performance", () => {
  bench(
    "createMinionUIContext instantiation x1000",
    () => {
      const bus = new EventBus();
      for (let i = 0; i < 1000; i++) {
        createMinionUIContext(bus, `m${i}`, `minion-${i}`, 60_000);
      }
    },
    { time: 1000 },
  );

  bench(
    "confirm round-trip (proxy → handler → response) x100",
    async () => {
      const bus = new EventBus();
      const parentUi = {
        confirm: async () => true,
        select: async () => "A",
        input: async () => "text",
        editor: async () => "edited",
      };

      createInteractionHandler(bus, () => parentUi as any);
      const proxy = createMinionUIContext(bus, "m1", "bench-minion", 60_000);

      const promises: Promise<boolean>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(proxy.confirm("Allow?", "test"));
      }
      await Promise.all(promises);
    },
    { time: 2000 },
  );

  bench(
    "select round-trip x100",
    async () => {
      const bus = new EventBus();
      const parentUi = {
        confirm: async () => true,
        select: async () => "B",
        input: async () => "text",
        editor: async () => "edited",
      };

      createInteractionHandler(bus, () => parentUi as any);
      const proxy = createMinionUIContext(bus, "m1", "bench-minion", 60_000);

      const promises: Promise<string | undefined>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(proxy.select("Pick", ["A", "B", "C"]));
      }
      await Promise.all(promises);
    },
    { time: 2000 },
  );

  bench(
    "concurrent requests from 10 minions x10 each",
    async () => {
      const bus = new EventBus();
      const parentUi = {
        confirm: async () => true,
        select: async () => "A",
        input: async () => "text",
        editor: async () => "edited",
      };

      createInteractionHandler(bus, () => parentUi as any);

      const proxies = Array.from({ length: 10 }, (_, i) =>
        createMinionUIContext(bus, `m${i}`, `minion-${i}`, 60_000),
      );

      const promises: Promise<boolean>[] = [];
      for (const proxy of proxies) {
        for (let i = 0; i < 10; i++) {
          promises.push(proxy.confirm("Allow?", "test"));
        }
      }
      await Promise.all(promises);
    },
    { time: 2000 },
  );

  bench(
    "passive no-op methods x10000 (overhead check)",
    () => {
      const bus = new EventBus();
      const proxy = createMinionUIContext(bus, "m1", "bench-minion", 60_000);

      for (let i = 0; i < 10000; i++) {
        proxy.notify("msg");
        proxy.setStatus("key", "val");
        proxy.setWidget("key", undefined);
        proxy.setWorkingMessage("working");
      }
    },
    { time: 1000 },
  );
});
