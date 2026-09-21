import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

export interface Skill {
  sourcePath: string;
  frontmatter: { name: string; description: string; version?: string; inputs?: unknown[]; triggers?: string[]; outputs?: unknown };
  body: string;
}
export function parseSkill(content: string, sourcePath: string): Skill {
  const match = content.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('Skill requires YAML frontmatter');
  const metadata = parse(match[1]!, { maxAliasCount: 20 });
  if (!metadata || typeof metadata.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(metadata.name)
    || typeof metadata.description !== 'string' || !metadata.description.trim()) throw new Error('Skill requires a valid name and description');
  return { sourcePath: resolve(sourcePath), frontmatter: metadata, body: match[2]! };
}
/** Directories ordered from lowest to highest precedence. */
export class SkillRegistry {
  diagnostics: Array<{ path: string; message: string }> = [];
  constructor(private directories: string[]) {}
  async list(): Promise<Skill[]> {
    this.diagnostics = [];
    const selected = new Map<string, Skill>();
    for (const directory of this.directories) {
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.diagnostics.push({ path: directory, message: String(error) }); continue; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) continue;
        const path = join(directory, entry.name, 'SKILL.md');
        try { const skill = parseSkill(await fs.readFile(path, 'utf8'), path); selected.set(skill.frontmatter.name, skill); }
        catch (error) { this.diagnostics.push({ path, message: String(error) }); }
      }
    }
    return [...selected.values()].sort((a, b) => a.frontmatter.name.localeCompare(b.frontmatter.name));
  }
  async read(name: string) { return (await this.list()).find((skill) => skill.frontmatter.name === name); }
}
