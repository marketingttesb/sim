import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile, readdir, stat, watch, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, relative, basename } from "path";
import { fileURLToPath } from "url";
import { cwd } from "process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(__dirname, "..", "memory");
const RESOURCE_PREFIX = "memory://";

function uri(p) {
  return `${RESOURCE_PREFIX}${p.replace(/\\/g, "/")}`;
}

function nameFromUri(u) {
  return u.replace(RESOURCE_PREFIX, "");
}

function detectProject() {
  return basename(cwd());
}

async function findMdFiles(dir, basePath = "") {
  const entries = [];
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = join(dir, item.name);
    const relPath = basePath ? `${basePath}/${item.name}` : item.name;
    if (item.isDirectory()) {
      const sub = await findMdFiles(fullPath, relPath);
      entries.push(...sub);
    } else if (item.name.endsWith(".md")) {
      entries.push(relPath);
    }
  }
  return entries;
}

async function readMemoryFile(relPath) {
  const path = join(MEMORY_DIR, relPath);
  const content = await readFile(path, "utf-8");
  const st = await stat(path);
  return { content, mtime: st.mtime.toISOString(), size: st.size };
}

function categorizePath(relPath) {
  const parts = relPath.replace(/\\/g, "/").split("/");
  if (parts[0] === "general") {
    return { group: "general", label: parts.slice(1).join("/") || parts[0] };
  }
  if (parts[0] === "projects" && parts.length >= 3) {
    return {
      group: "project",
      project: parts[1],
      label: parts.slice(2).join("/"),
    };
  }
  return { group: "other", label: relPath };
}

const server = new Server(
  {
    name: "memory-server",
    version: "1.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const allFiles = await findMdFiles(MEMORY_DIR);
  const resources = allFiles.map((f) => {
    const cat = categorizePath(f);
    const displayName = cat.group === "general"
      ? `general/${cat.label}`
      : `${cat.project}/${cat.label}`;
    return {
      uri: uri(f),
      name: displayName.replace(/\.md$/, ""),
      description: `Memory: ${displayName}`,
      mimeType: "text/markdown",
    };
  });
  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const relPath = nameFromUri(request.params.uri);
  const { content, mtime } = await readMemoryFile(relPath);
  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: "text/markdown",
        text: content,
        metadata: { updatedAt: mtime },
      },
    ],
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_memory",
        description: "Read content of a memory file",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "File path relative to memory dir, e.g. general/session, projects/sim/context",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "update_memory",
        description: "Update or append to a memory file",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "File path relative to memory dir, e.g. general/session, projects/sim/context",
            },
            content: { type: "string", description: "Content to write" },
            mode: {
              type: "string",
              enum: ["append", "overwrite"],
              description: "Append or overwrite",
              default: "append",
            },
          },
          required: ["name", "content"],
        },
      },
      {
        name: "list_memories",
        description: "List all available memory files with metadata",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "read_memory": {
      const relPath = args.name.endsWith(".md") ? args.name : `${args.name}.md`;
      const { content, mtime } = await readMemoryFile(relPath);
      return {
        content: [
          { type: "text", text: `# ${args.name}\n> Last updated: ${mtime}\n\n${content}` },
        ],
      };
    }

    case "update_memory": {
      const relPath = args.name.endsWith(".md") ? args.name : `${args.name}.md`;
      const path = join(MEMORY_DIR, relPath);
      const mode = args.mode || "append";

      const parent = dirname(path);
      if (!existsSync(parent)) {
        await mkdir(parent, { recursive: true });
      }

      if (mode === "overwrite") {
        await writeFile(path, args.content, "utf-8");
      } else {
        const existing = existsSync(path) ? await readFile(path, "utf-8") : "";
        await writeFile(path, existing + "\n" + args.content, "utf-8");
      }

      return {
        content: [{ type: "text", text: `Updated ${args.name} (mode: ${mode})` }],
      };
    }

    case "list_memories": {
      const allFiles = await findMdFiles(MEMORY_DIR);
      const details = await Promise.all(
        allFiles.map(async (f) => {
          const st = await stat(join(MEMORY_DIR, f));
          return `${f} — ${st.size}b — ${st.mtime.toISOString()}`;
        })
      );
      return {
        content: [
          { type: "text", text: details.join("\n") || "No memory files found." },
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function startWatcher() {
  try {
    const ac = new AbortController();
    const watcher = watch(MEMORY_DIR, { recursive: true, signal: ac.signal });
    for await (const event of watcher) {
      if (event.eventType === "change") {
        const rel = relative(MEMORY_DIR, join(MEMORY_DIR, event.filename));
        server.sendResourceUpdate({ uri: uri(rel) });
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("Watcher error:", err);
    }
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  startWatcher();
}

main().catch(console.error);
