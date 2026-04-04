import type { MessageRenderer, MessageRenderOptions, Theme } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { Markdown } from "@mariozechner/pi-tui";
import { logger } from "../logger.js";

export const minionChangelogRenderer: MessageRenderer<{ content: string }> = (
  message,
  _options: MessageRenderOptions,
  _theme: Theme,
): Component | undefined => {
  logger.debug("minion-changelog:renderer", "render-called", {
    hasDetails: !!message.details,
    hasContent: !!message.details?.content,
    contentLength: message.details?.content?.length ?? 0,
  });

  const data = message.details;
  if (!data?.content) {
    logger.debug("minion-changelog:renderer", "no-content-returning-undefined");
    return undefined;
  }

  logger.debug("minion-changelog:renderer", "creating-markdown");
  return new Markdown(data.content.trim(), 1, 1, getMarkdownTheme());
};
