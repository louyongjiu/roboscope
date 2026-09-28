/**
 * Story V15.2 — the %{} badge turns into a warning when a ref is missing
 * from the environment keys provided by FlowEditor.
 */
import { describe, it, expect } from 'vitest'
import { computed } from 'vue'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import KeywordNode from '@/components/editor/flow/KeywordNode.vue'
import type { FlowNodeData } from '@/components/editor/flow/flowConverter'

const data: FlowNodeData = {
  label: 'Go To',
  stepType: 'keyword',
  step: {
    type: 'keyword', keyword: 'Go To', args: ['%{BASE_URL}'], returnVars: [],
    condition: '', loopVar: '', loopFlavor: '', loopValues: [],
    exceptPattern: '', exceptVar: '', varScope: '', comment: '',
  },
  section: 'testcase', sectionIndex: 0, stepIndex: 0, recording: null, argSpecs: null,
  envRefs: [{ name: 'BASE_URL', default: null }],
}

const i18n = createI18n({
  legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false,
  messages: { en: { flowEditor: { envVarNotDefined: '(not defined)' } } },
})

function badge(provide?: Record<string, unknown>) {
  return mount(KeywordNode, {
    props: { data },
    global: { plugins: [i18n], stubs: { Handle: true }, provide },
  }).get('[data-testid="env-badge"]')
}

describe('KeywordNode env badge (V15.2)', () => {
  it('renders the plain badge without provided keys', () => {
    const b = badge()
    expect(b.classes()).not.toContain('flow-node-env-badge--missing')
    expect(b.attributes('title')).toBe('%{BASE_URL}')
  })

  it('warns when a ref is not among the environment keys', () => {
    const b = badge({ envVarKeys: computed(() => new Set(['OTHER'])) })
    expect(b.classes()).toContain('flow-node-env-badge--missing')
    expect(b.attributes('title')).toBe('%{BASE_URL} (not defined)')
  })

  it('stays plain when the key is defined', () => {
    const b = badge({ envVarKeys: computed(() => new Set(['BASE_URL'])) })
    expect(b.classes()).not.toContain('flow-node-env-badge--missing')
  })
})
