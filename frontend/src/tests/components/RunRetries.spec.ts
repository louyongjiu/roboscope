import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import en from '@/i18n/locales/en'

// Story V15.3 — "Retries on failure" select + "Attempt n of m" label.

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}))

const RUN = {
  id: 12, repository_id: 1, environment_id: null, run_type: 'single', runner_type: 'subprocess',
  status: 'failed', target_path: 'tests', branch: 'main', tags_include: null, tags_exclude: null,
  parallel: false, retry_count: 1, max_retries: 2, timeout_seconds: 3600, task_id: null,
  started_at: null, finished_at: null, duration_seconds: null, triggered_by: 1, error_message: null,
  created_at: '2026-09-25T02:00:00',
}

vi.mock('@/api/execution.api', () => ({
  getRuns: vi.fn(),
  getSchedules: vi.fn().mockResolvedValue([]),
  createRun: vi.fn(),
  runScheduleNow: vi.fn(),
  getRunOutput: vi.fn(),
  listModifiers: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/api/repos.api', () => ({ getRepos: vi.fn().mockResolvedValue([]) }))
vi.mock('@/api/environments.api', () => ({
  getEnvironments: vi.fn().mockResolvedValue([{ id: 3, name: 'default' }]),
  buildDockerImage: vi.fn(),
}))
vi.mock('@/api/reports.api', () => ({}))
vi.mock('@/api/explorer.api', () => ({ getRepoTags: vi.fn().mockResolvedValue([]) }))
const flags = { advanced: false }
vi.mock('@/composables/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ isEnabled: (k: string) => k === 'executionAdvancedArgs' && flags.advanced }),
}))

import * as executionApi from '@/api/execution.api'
import ExecutionView from '@/views/ExecutionView.vue'
import AdvancedRunConfig from '@/components/execution/AdvancedRunConfig.vue'
import { useAuthStore } from '@/stores/auth.store'

async function mountView() {
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const wrapper = shallowMount(ExecutionView, {
    global: {
      plugins: [i18n],
      stubs: { BaseModal: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' } },
    },
  })
  await flushPromises()
  ;(wrapper.vm as unknown as { showRunDialog: boolean }).showRunDialog = true
  await flushPromises()
  return wrapper
}

describe('V15.3 run retries', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    flags.advanced = false
    vi.mocked(executionApi.getRuns).mockResolvedValue({ items: [RUN], total: 1, page: 1, page_size: 20 } as never)
    vi.mocked(executionApi.createRun).mockResolvedValue({ ...RUN, id: 13 } as never)
    useAuthStore().user = { id: 1, role: 'runner' } as never
  })

  it('sends the selected retries as max_retries', async () => {
    const wrapper = await mountView()
    await wrapper.find('[data-testid="run-max-retries"]').setValue('2')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(executionApi.createRun).toHaveBeenCalledWith(expect.objectContaining({ max_retries: 2 }))
    expect(vi.mocked(executionApi.createRun).mock.calls[0][0]).not.toHaveProperty('parallel')
  })

  it('disables retries and sends 0 when advanced options are set', async () => {
    flags.advanced = true
    const wrapper = await mountView()
    await wrapper.find('[data-testid="run-max-retries"]').setValue('2')
    wrapper.findComponent(AdvancedRunConfig).vm.$emit('update:argsText', '--dryrun')
    await flushPromises()
    const select = wrapper.find('[data-testid="run-max-retries"]')
    expect(select.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain(en.execution.runDialog.retriesDisabledAdvanced)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(executionApi.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ max_retries: 0, advanced_config: { args: ['--dryrun'] } }),
    )
  })

  it('shows "Attempt 2 of 3" in the runs table', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="run-attempt"]').text()).toBe('Attempt 2 of 3')
  })
})
