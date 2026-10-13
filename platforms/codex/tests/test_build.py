import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('build', ROOT / 'build.py')
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = BUILD.build(Path(self.temp.name) / 'plugin')

    def test_all_skills_and_commands(self):
        source_skills = list((BUILD.SOURCE / 'skills').glob('*/SKILL.md'))
        commands = list((BUILD.SOURCE / 'commands').glob('*.md'))
        generated = list((self.output / 'skills').glob('*/SKILL.md'))
        self.assertEqual(len(generated), len(source_skills) + len(commands))
        for source in source_skills + commands:
            name = source.parent.name if source.name == 'SKILL.md' else source.stem
            text = (self.output / 'skills' / name / 'SKILL.md').read_text()
            fields, body = BUILD.frontmatter(text)
            self.assertEqual(fields['name'], name)
            self.assertIn('Maister Codex execution adapter', body)
            _, source_body = BUILD.frontmatter(source.read_text())
            self.assertTrue(body.endswith(BUILD.translate(source_body)))

    def test_agents_preserve_body_and_configs(self):
        for source in (BUILD.SOURCE / 'agents').glob('*.md'):
            fields, body = BUILD.frontmatter(source.read_text())
            generated = self.output / 'agents' / source.name
            self.assertIn(BUILD.translate(body), generated.read_text())
            self.assertIn('Maister Codex execution adapter', generated.read_text())
            config = generated.with_suffix('.toml').read_text()
            values = {line.split(' = ', 1)[0]: json.loads(line.split(' = ', 1)[1])
                      for line in config.splitlines()}
            self.assertEqual(values['name'], 'maister-' + source.stem)
            self.assertIn(BUILD.translate(body), values['developer_instructions'])
            if source.stem == 'docs-operator':
                self.assertIn('Preload and follow', values['developer_instructions'])

    def test_assets_unchanged(self):
        for source in (BUILD.SOURCE / 'skills').rglob('*'):
            if source.is_file() and source.suffix != '.md':
                self.assertEqual(source.read_bytes(),
                                 (self.output / source.relative_to(BUILD.SOURCE)).read_bytes())
        source_mcp = json.loads((BUILD.SOURCE / '.mcp.json').read_text())
        portable_mcp = json.loads((self.output / 'mcp.json').read_text())
        self.assertEqual(portable_mcp['$schema'],
                         'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json')
        for name, source_server in source_mcp['mcpServers'].items():
            self.assertEqual(portable_mcp['mcpServers'][name],
                             dict(source_server, type='stdio'))

    def test_source_hash_coverage(self):
        coverage = json.loads((self.output / 'source-coverage.json').read_text())
        files = [p for p in BUILD.SOURCE.rglob('*') if p.is_file()]
        self.assertEqual(len(coverage), len(files))
        for source in files:
            self.assertEqual(coverage[str(source.relative_to(BUILD.SOURCE))],
                             hashlib.sha256(source.read_bytes()).hexdigest())

    def test_platform_transformations(self):
        for directory in ('agents', 'skills'):
            for file in (self.output / directory).rglob('*.md'):
                with self.subTest(file=file):
                    text = file.read_text()
                    self.assertNotIn('CLAUDE_PLUGIN_ROOT', text)
                    self.assertNotIn('CLAUDE.md', text)
                    self.assertNotIn('.claude-plugin/plugin.json', text)
                    self.assertNotIn('/maister:', text)
                    self.assertNotIn('$maister-codex:', text)
                    self.assertNotIn('$maister-init', text)
                    self.assertNotIn('subagent_type="Explore"', text)
        self.assertTrue((self.output / 'skills/docs-manager/references/agents-md-template.md').is_file())

    def test_manifests_and_scripts(self):
        manifest = json.loads((self.output / 'plugin.json').read_text())
        self.assertEqual(manifest['name'], 'maister')
        self.assertEqual(manifest['version'],
                         json.loads((BUILD.SOURCE / 'plugin.json').read_text())['version'])
        self.assertTrue((self.output / 'skills').is_dir())
        self.assertTrue((self.output / 'mcp.json').is_file())
        self.assertTrue((self.output /
                         manifest['extensions']['com.openai']['hooks']).exists())
        self.assertTrue((self.output / 'runtime/tasks.py').is_file())
        self.assertTrue((self.output / 'hooks/guard.py').is_file())
        instructions = (self.output / 'AGENTS.md').read_text()
        self.assertIn('$maister:<operation>', instructions)
        self.assertIn('hooks/guard.py', instructions)
        self.assertNotIn('code.claude.com', instructions)

    def test_shared_namespace_and_native_invocation(self):
        self.assertEqual(BUILD.translate('/maister:work Fix login --type=bug'),
                         '$maister:work Fix login --type=bug\n')
        self.assertEqual(BUILD.translate('maister:development maister:task-group-implementer'),
                         'maister:development maister:task-group-implementer\n')
        marketplace = json.loads((BUILD.ROOT / '.agents/plugins/marketplace.json').read_text())
        plugin = next(item for item in marketplace['plugins'] if item['name'] == 'maister')
        self.assertEqual(plugin['source']['path'], './plugins/maister-codex')
        readme = (self.output / 'README.md').read_text()
        for source in (BUILD.SOURCE / 'commands').glob('*.md'):
            self.assertIn('$maister:' + source.stem, readme)

    def test_deterministic_rebuild(self):
        def snapshot():
            return {str(p.relative_to(self.output)): p.read_bytes()
                    for p in self.output.rglob('*') if p.is_file()}
        before = snapshot()
        BUILD.build(self.output)
        self.assertEqual(snapshot(), before)

    def test_rejects_unmarked_output_and_source_overlap(self):
        for path in (BUILD.SOURCE, BUILD.SOURCE.parent, Path(self.temp.name)):
            with self.subTest(path=path), self.assertRaises(ValueError):
                BUILD.build(path)

    def test_internal_skill_policy(self):
        for source in (BUILD.SOURCE / 'skills').glob('*/SKILL.md'):
            fields, _ = BUILD.frontmatter(source.read_text())
            policy = self.output / 'skills' / source.parent.name / 'agents/openai.yaml'
            self.assertEqual(policy.exists(), fields.get('user-invocable') == 'false')


if __name__ == '__main__':
    unittest.main()
