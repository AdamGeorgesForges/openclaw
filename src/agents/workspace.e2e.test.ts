import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentBootstrapPresetConfig } from "../config/types.agent-defaults.js";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import type { WorkspaceBootstrapFile } from "./workspace.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
  ensureAgentWorkspace,
  filterBootstrapFilesForSession,
  loadWorkspaceBootstrapFiles,
  resolveDefaultAgentWorkspaceDir,
} from "./workspace.js";

describe("resolveDefaultAgentWorkspaceDir", () => {
  it("uses OPENCLAW_HOME for default workspace resolution", () => {
    const dir = resolveDefaultAgentWorkspaceDir({
      OPENCLAW_HOME: "/srv/openclaw-home",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv);

    expect(dir).toBe(path.join(path.resolve("/srv/openclaw-home"), ".openclaw", "workspace"));
  });
});

const WORKSPACE_STATE_PATH_SEGMENTS = [".openclaw", "workspace-state.json"] as const;

const PRESET_SOURCE_DIR_SEGMENTS = ["presets", "bootstrap"] as const;

async function readOnboardingState(dir: string): Promise<{
  version: number;
  bootstrapSeededAt?: string;
  onboardingCompletedAt?: string;
}> {
  const raw = await fs.readFile(path.join(dir, ...WORKSPACE_STATE_PATH_SEGMENTS), "utf-8");
  return JSON.parse(raw) as {
    version: number;
    bootstrapSeededAt?: string;
    onboardingCompletedAt?: string;
  };
}

async function writePresetSources(params: {
  dir: string;
  soul?: string;
  identity?: string;
  user?: string;
  heartbeat?: string;
  bootstrap?: string;
  agents?: string;
}): Promise<string> {
  const presetDir = path.join(params.dir, ...PRESET_SOURCE_DIR_SEGMENTS);
  await fs.mkdir(presetDir, { recursive: true });
  const entries: Array<[string, string]> = [
    ["soul.md", params.soul ?? "preset soul"],
    ["identity.md", params.identity ?? "preset identity"],
    ["user.md", params.user ?? "preset user"],
    ["heartbeat.md", params.heartbeat ?? "preset heartbeat"],
    ["bootstrap.md", params.bootstrap ?? "preset bootstrap"],
    ["agents.md", params.agents ?? "preset agents"],
  ];
  await Promise.all(
    entries.map(([name, content]) => fs.writeFile(path.join(presetDir, name), content, "utf-8")),
  );
  return presetDir;
}

function makePathPreset(): AgentBootstrapPresetConfig {
  return {
    enabled: true,
    baseDir: "presets/bootstrap",
    files: {
      soul: { path: "soul.md" },
      identity: { path: "identity.md" },
      user: { path: "user.md" },
      heartbeat: { path: "heartbeat.md" },
      bootstrap: { enabled: false, path: "bootstrap.md" },
    },
  };
}

describe("ensureAgentWorkspace", () => {
  it("creates BOOTSTRAP.md and records a seeded marker for brand new workspaces", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expect(
      fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME)),
    ).resolves.toBeUndefined();
    const state = await readOnboardingState(tempDir);
    expect(state.bootstrapSeededAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(state.onboardingCompletedAt).toBeUndefined();
  });

  it("recovers partial initialization by creating BOOTSTRAP.md when marker is missing", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_AGENTS_FILENAME, content: "existing" });

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expect(
      fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME)),
    ).resolves.toBeUndefined();
    const state = await readOnboardingState(tempDir);
    expect(state.bootstrapSeededAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("does not recreate BOOTSTRAP.md after completion, even when a core file is recreated", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_IDENTITY_FILENAME, content: "custom" });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_USER_FILENAME, content: "custom" });
    await fs.unlink(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME));
    await fs.unlink(path.join(tempDir, DEFAULT_TOOLS_FILENAME));

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expect(fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.access(path.join(tempDir, DEFAULT_TOOLS_FILENAME))).resolves.toBeUndefined();
    const state = await readOnboardingState(tempDir);
    expect(state.onboardingCompletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("does not re-seed BOOTSTRAP.md for legacy completed workspaces without state marker", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_IDENTITY_FILENAME, content: "custom" });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_USER_FILENAME, content: "custom" });

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expect(fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const state = await readOnboardingState(tempDir);
    expect(state.bootstrapSeededAt).toBeUndefined();
    expect(state.onboardingCompletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe("ensureAgentWorkspace bootstrapPreset", () => {
  it("seeds configured files from preset paths on a fresh workspace", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writePresetSources({
      dir: tempDir,
      agents: "preset agents",
      soul: "preset soul",
      identity: "preset identity",
      user: "preset user",
      heartbeat: "preset heartbeat",
      bootstrap: "preset bootstrap",
    });

    await ensureAgentWorkspace({
      dir: tempDir,
      ensureBootstrapFiles: true,
      bootstrapPreset: {
        ...makePathPreset(),
        files: { ...makePathPreset().files, agents: { path: "agents.md" } },
      },
      bootstrapPresetBaseDir: tempDir,
    });

    await expect(fs.readFile(path.join(tempDir, DEFAULT_AGENTS_FILENAME), "utf-8")).resolves.toBe(
      "preset agents",
    );
    await expect(fs.readFile(path.join(tempDir, DEFAULT_SOUL_FILENAME), "utf-8")).resolves.toBe(
      "preset soul",
    );
    await expect(fs.readFile(path.join(tempDir, DEFAULT_IDENTITY_FILENAME), "utf-8")).resolves.toBe(
      "preset identity",
    );
    await expect(fs.readFile(path.join(tempDir, DEFAULT_USER_FILENAME), "utf-8")).resolves.toBe(
      "preset user",
    );
    await expect(
      fs.readFile(path.join(tempDir, DEFAULT_HEARTBEAT_FILENAME), "utf-8"),
    ).resolves.toBe("preset heartbeat");
    await expect(fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not overwrite existing files when force is disabled", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writePresetSources({
      dir: tempDir,
      identity: "preset identity",
      user: "preset user",
    });
    await writeWorkspaceFile({
      dir: tempDir,
      name: DEFAULT_IDENTITY_FILENAME,
      content: "existing",
    });

    await ensureAgentWorkspace({
      dir: tempDir,
      ensureBootstrapFiles: true,
      bootstrapPreset: makePathPreset(),
      bootstrapPresetBaseDir: tempDir,
    });

    await expect(fs.readFile(path.join(tempDir, DEFAULT_IDENTITY_FILENAME), "utf-8")).resolves.toBe(
      "existing",
    );
  });

  it("overwrites existing files when force is enabled", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writePresetSources({
      dir: tempDir,
      identity: "preset identity forced",
      user: "preset user forced",
    });
    await writeWorkspaceFile({
      dir: tempDir,
      name: DEFAULT_IDENTITY_FILENAME,
      content: "existing",
    });

    await ensureAgentWorkspace({
      dir: tempDir,
      ensureBootstrapFiles: true,
      bootstrapPreset: { ...makePathPreset(), force: true },
      bootstrapPresetBaseDir: tempDir,
    });

    await expect(fs.readFile(path.join(tempDir, DEFAULT_IDENTITY_FILENAME), "utf-8")).resolves.toBe(
      "preset identity forced",
    );
  });

  it("supports preset seeding when BOOTSTRAP.md creation is disabled", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writePresetSources({
      dir: tempDir,
      soul: "preset soul",
      identity: "preset identity",
      user: "preset user",
    });

    await ensureAgentWorkspace({
      dir: tempDir,
      ensureBootstrapFiles: true,
      createBootstrapFile: false,
      bootstrapPreset: makePathPreset(),
      bootstrapPresetBaseDir: tempDir,
    });

    await expect(fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.readFile(path.join(tempDir, DEFAULT_SOUL_FILENAME), "utf-8")).resolves.toBe(
      "preset soul",
    );
  });
});

describe("loadWorkspaceBootstrapFiles", () => {
  const getMemoryEntries = (files: Awaited<ReturnType<typeof loadWorkspaceBootstrapFiles>>) =>
    files.filter((file) =>
      [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME].includes(file.name),
    );

  const expectSingleMemoryEntry = (
    files: Awaited<ReturnType<typeof loadWorkspaceBootstrapFiles>>,
    content: string,
  ) => {
    const memoryEntries = getMemoryEntries(files);
    expect(memoryEntries).toHaveLength(1);
    expect(memoryEntries[0]?.missing).toBe(false);
    expect(memoryEntries[0]?.content).toBe(content);
  };

  it("includes MEMORY.md when present", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: "MEMORY.md", content: "memory" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    expectSingleMemoryEntry(files, "memory");
  });

  it("includes memory.md when MEMORY.md is absent", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: "memory.md", content: "alt" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    expectSingleMemoryEntry(files, "alt");
  });

  it("omits memory entries when no memory files exist", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    expect(getMemoryEntries(files)).toHaveLength(0);
  });
});

describe("filterBootstrapFilesForSession", () => {
  it("keeps sub-agent filtering restricted to AGENTS.md and TOOLS.md", () => {
    const files: WorkspaceBootstrapFile[] = [
      { name: DEFAULT_AGENTS_FILENAME, path: "/tmp/AGENTS.md", missing: false, content: "a" },
      { name: DEFAULT_SOUL_FILENAME, path: "/tmp/SOUL.md", missing: false, content: "s" },
      { name: DEFAULT_TOOLS_FILENAME, path: "/tmp/TOOLS.md", missing: false, content: "t" },
      { name: DEFAULT_IDENTITY_FILENAME, path: "/tmp/IDENTITY.md", missing: false, content: "i" },
    ];

    const filtered = filterBootstrapFilesForSession(files, "agent:main:subagent:test");
    expect(filtered.map((file) => file.name)).toEqual([
      DEFAULT_AGENTS_FILENAME,
      DEFAULT_TOOLS_FILENAME,
    ]);
  });
});
