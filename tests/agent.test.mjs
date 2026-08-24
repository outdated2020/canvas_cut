import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import agent from '../packages/agent/dist/index.js';

const { parseSkill, SkillRegistry, cliToolsFromManifest } = agent;

test('parseSkill extracts frontmatter and body', () => {
  const skill = parseSkill(
    [
      '---',
      'name: storyboard-to-video',
      'description: Make a video from a storyboard',
      'version: 1.0.0',
      '---',
      '# Steps',
      '1. Create canvas'
    ].join('\n'),
    '/tmp/SKILL.md'
  );
  assert.equal(skill.frontmatter.name, 'storyboard-to-video');
  assert.match(skill.body, /Create canvas/);
});

test('SkillRegistry lists skills from directories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-cut-skills-'));
  try {
    const skillDir = join(dir, 'storyboard-to-video');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: demo-skill\ndescription: Demo skill\n---\n# Body'
    );
    const registry = new SkillRegistry([dir]);
    const skills = await registry.list();
    assert.equal(skills.length, 1);
    assert.equal(skills[0].frontmatter.name, 'demo-skill');
    assert.equal((await registry.read('demo-skill')).frontmatter.name, 'demo-skill');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cliToolsFromManifest generates stable tool names and schemas', () => {
  const tools = cliToolsFromManifest();
  assert.ok(tools.length > 30);
  const renderTool = tools.find((tool) => tool.name === 'canvas_render');
  assert.ok(renderTool);
  assert.equal(renderTool.inputSchema.required[0], 'canvas');
  const generateTool = tools.find((tool) => tool.name === 'generate_text_to_image');
  assert.ok(generateTool);
  assert.ok(generateTool.inputSchema.properties.prompt);
});
