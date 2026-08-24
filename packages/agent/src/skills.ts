import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import { basename, join } from 'node:path';

export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  inputs?: Array<{
    name: string;
    type: string;
    required?: boolean;
    default?: string;
    description?: string;
  }>;
  outputs?: string;
  triggers?: string[];
}

export interface Skill {
  sourcePath: string;
  frontmatter: SkillFrontmatter;
  body: string;
}

export function parseSkill(content: string, sourcePath: string): Skill {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return {
      sourcePath,
      frontmatter: {
        name: basename(sourcePath, '.md'),
        description: content.slice(0, 200)
      },
      body: content
    };
  }

  const frontmatter: SkillFrontmatter = { name: '', description: '' };
  for (const line of match[1]?.split(/\r?\n/) ?? []) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === 'name') frontmatter.name = value;
    else if (key === 'description') frontmatter.description = value;
    else if (key === 'version') frontmatter.version = value;
    else if (key === 'outputs') frontmatter.outputs = value;
  }
  return {
    sourcePath,
    frontmatter,
    body: match[2] ?? ''
  };
}

export class SkillRegistry {
  constructor(private readonly directories: string[]) {}

  async list(): Promise<Skill[]> {
    const skills: Skill[] = [];
    for (const directory of this.directories) {
      let entries: Dirent[] = [];
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = join(directory, entry.name, 'SKILL.md');
          try {
            const content = await fs.readFile(skillPath, 'utf8');
            skills.push(parseSkill(content, skillPath));
          } catch {
            // Ignore missing skills.
          }
        }
      }
    }
    return skills;
  }

  async read(name: string): Promise<Skill | undefined> {
    const skills = await this.list();
    return skills.find((skill) => skill.frontmatter.name === name);
  }
}
