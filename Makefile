.PHONY: build validate clean watch build-codex test-codex

build-codex:
	PYTHONDONTWRITEBYTECODE=1 python3 platforms/codex/build.py

test-codex:
	PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s platforms/codex/tests -v

build:
	bash platforms/copilot-cli/build.sh

validate:
	@echo "Checking portable plugin manifest..."
	@test -f plugins/maister/plugin.json || (echo "FAIL: missing plugins/maister/plugin.json" && exit 1)
	@test -f plugins/maister-copilot/plugin.json || (echo "FAIL: generated variant missing plugin.json; run make build" && exit 1)
	@echo "Checking dashboard tooling survives the Copilot build..."
	@for name in ensure-dashboards generate-task-index validate-dashboard-data validate-task-index validate-dashboard-state-sync; do test -f "plugins/maister-copilot/skills/orchestrator-framework/scripts/$$name.mjs" || { echo "FAIL: missing dashboard script $$name.mjs"; exit 1; }; done
	@test -f plugins/maister-copilot/skills/orchestrator-framework/assets/tasks-dashboard.html || (echo "FAIL: missing central dashboard asset" && exit 1)
	@echo "Checking shared state runtime, tests, and vendored parser survive the Copilot build..."
	@for rel in scripts/state-semantics.mjs tests/derived-projections.test.mjs vendor/yaml-2.9.1/LICENSE vendor/yaml-2.9.1/PROVENANCE.json vendor/yaml-2.9.1/dist/index.js; do cmp -s "plugins/maister/skills/orchestrator-framework/$$rel" "plugins/maister-copilot/skills/orchestrator-framework/$$rel" || { echo "FAIL: orchestrator framework asset drift: $$rel"; exit 1; }; done
	@echo "Checking no colons in command names..."
	@! grep -r '^name:.*:' plugins/maister-copilot/commands/ 2>/dev/null || (echo "FAIL: colons in command names" && exit 1)
	@echo "Checking no multi-select references..."
	@! grep -ri 'multi.select\|multiSelect' plugins/maister-copilot/skills/ 2>/dev/null || (echo "FAIL: multi-select found in skills" && exit 1)
	@echo "Checking commands are flat (no subdirectories)..."
	@test $$(find plugins/maister-copilot/commands -mindepth 2 -name "*.md" 2>/dev/null | wc -l) -eq 0 || (echo "FAIL: nested command directories found" && exit 1)
	@echo "Checking no CLAUDE.md references in skills..."
	@! grep -ri 'CLAUDE\.md' plugins/maister-copilot/skills/ 2>/dev/null || (echo "FAIL: CLAUDE.md references found in skills" && exit 1)
	@echo "Checking no maister- prefix in copilot command names..."
	@! grep -r '^name: maister-' plugins/maister-copilot/commands/ 2>/dev/null || (echo "FAIL: maister- prefix in command names" && exit 1)
	@echo "Checking no maister: prefixes in copilot variant..."
	@! grep -r 'maister:' plugins/maister-copilot/ --include="*.md" --include="*.json" --include="*.mjs" --include="*.yml" 2>/dev/null || (echo "FAIL: maister: prefix found" && exit 1)
	@echo "Checking gate markers are not nested inside code spans..."
	@! grep -rnF '`→ **MANDATORY GATE** — fires ' plugins/maister/skills/ 2>/dev/null || (echo "FAIL: gate marker nested inside a code span" && exit 1)
	@! grep -nF '→ Pause' plugins/maister/skills/orchestrator-framework/references/orchestrator-creation-checklist.md 2>/dev/null || (echo "FAIL: superseded transition marker in the orchestrator checklist" && exit 1)
	@echo "Checking the plugin-root variable is renamed for the Copilot variant..."
	@! grep -rn 'CLAUDE_PLUGIN_ROOT' plugins/maister-copilot/skills/ --include="*.md" 2>/dev/null || (echo "FAIL: a Claude-only plugin-root variable survives in the emitted skills" && exit 1)
	@test "$$(grep -rl 'MAISTER_PLUGIN_ROOT' plugins/maister-copilot/skills/ --include="*.md" 2>/dev/null | wc -l | tr -d ' ')" = "$$(grep -rl 'CLAUDE_PLUGIN_ROOT' plugins/maister/skills/ --include="*.md" 2>/dev/null | wc -l | tr -d ' ')" || (echo "FAIL: the emitted skills' plugin-root variable count drifted from the source tree" && exit 1)
	@echo "Checking every hooks.json command path exists on disk..."
	@for rel in $$(grep -o 'hooks/[A-Za-z0-9_.-]*\.\(sh\|mjs\)' plugins/maister/hooks/hooks.json | sort -u); do test -f "plugins/maister/$$rel" || { echo "FAIL: hooks.json names plugins/maister/$$rel, which does not exist"; exit 1; }; done
	@echo "All checks passed"

clean:
	rm -rf plugins/maister-copilot/

watch:
	fswatch -o plugins/maister/ | xargs -n1 -I{} make build
