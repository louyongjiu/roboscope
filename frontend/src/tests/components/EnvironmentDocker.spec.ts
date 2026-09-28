/**
 * V15.5 — EnvironmentsView Docker section: edit / import / reset the
 * Dockerfile and switch to a user-provided image.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import EnvironmentsView from '@/views/EnvironmentsView.vue'
import en from '@/i18n/locales/en'
import { useAuthStore } from '@/stores/auth.store'
import type { Environment } from '@/types/domain.types'

vi.mock('@/composables/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}))

const GENERATED = 'FROM python:3.12-slim\nRUN uv pip install --system robotframework\n'
let env: Environment

vi.mock('@/api/environments.api', () => ({
  getEnvironments: vi.fn(async () => [env]),
  getPopularPackages: vi.fn(async () => []),
  getPackages: vi.fn(async () => []),
  getInstalledPackages: vi.fn(async () => []),
  getVariables: vi.fn(async () => []),
  getDockerfile: vi.fn(async () => GENERATED),
  saveDockerfile: vi.fn(async (_id: number, content: string | null) => ({ id: 7, dockerfile_customized: content !== null })),
  updateEnvironment: vi.fn(async (_id: number, data: Partial<Environment>) => ({ id: 7, ...data })),
}))

import * as envsApi from '@/api/environments.api'

async function mountOpen(editor = true) {
  const auth = useAuthStore()
  vi.spyOn(auth, 'hasMinRole').mockReturnValue(editor)
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const w = mount(EnvironmentsView, { global: { plugins: [i18n] }, attachTo: document.body })
  await flushPromises()
  await w.find('.card-header').trigger('click')
  await flushPromises()
  return w
}

async function openDockerfile(w: Awaited<ReturnType<typeof mountOpen>>) {
  const details = w.find('[data-testid="dockerfile-details"]')
  ;(details.element as HTMLDetailsElement).open = true
  await details.trigger('toggle')
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  env = { id: 7, name: 'staging', python_version: '3.12', venv_kind: 'managed', docker_image: null } as Environment
})

describe('EnvironmentsView Docker customization', () => {
  it('edits and saves the Dockerfile, then shows the badge', async () => {
    const w = await mountOpen()
    await openDockerfile(w)
    const editor = w.find('[data-testid="dockerfile-editor"]')
    expect((editor.element as HTMLTextAreaElement).value).toBe(GENERATED)
    await editor.setValue('FROM myorg/base:1\n')
    await w.find('[data-testid="dockerfile-save"]').trigger('click')
    await flushPromises()
    expect(envsApi.saveDockerfile).toHaveBeenCalledWith(7, 'FROM myorg/base:1\n')
    expect(w.find('[data-testid="docker-custom-dockerfile-badge"]').exists()).toBe(true)
    w.unmount()
  })

  it('resets to the generated Dockerfile', async () => {
    env.dockerfile_customized = true
    const w = await mountOpen()
    await openDockerfile(w)
    await w.find('[data-testid="dockerfile-reset"]').trigger('click')
    await flushPromises()
    expect(envsApi.saveDockerfile).toHaveBeenCalledWith(7, null)
    expect(envsApi.getDockerfile).toHaveBeenCalledTimes(2) // reloaded generated
    expect(w.find('[data-testid="docker-custom-dockerfile-badge"]').exists()).toBe(false)
    w.unmount()
  })

  it('imports a file into the editor without saving it', async () => {
    const w = await mountOpen()
    await openDockerfile(w)
    const input = w.find('[data-testid="dockerfile-import"]')
    const file = new File(['FROM imported:1\n'], 'Dockerfile', { type: 'text/plain' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect((w.find('[data-testid="dockerfile-editor"]').element as HTMLTextAreaElement).value).toBe('FROM imported:1\n')
    expect(envsApi.saveDockerfile).not.toHaveBeenCalled()
    w.unmount()
  })

  it('sets a custom image and switches back to managed', async () => {
    const w = await mountOpen()
    await w.find('[data-testid="docker-own-image-input"]').setValue(' myorg/rf:1 ')
    await w.find('[data-testid="docker-own-image-form"]').trigger('submit')
    await flushPromises()
    expect(envsApi.updateEnvironment).toHaveBeenCalledWith(7, { docker_image: 'myorg/rf:1', docker_image_custom: true })
    expect(w.find('[data-testid="docker-custom-image-badge"]').exists()).toBe(true)

    await w.find('[data-testid="docker-managed-image"]').trigger('click')
    await flushPromises()
    expect(envsApi.updateEnvironment).toHaveBeenLastCalledWith(7, { docker_image: null, docker_image_custom: false })
    expect(w.find('[data-testid="docker-custom-image-badge"]').exists()).toBe(false)
    w.unmount()
  })

  it('is read-only below editor', async () => {
    const w = await mountOpen(false)
    expect(w.find('[data-testid="docker-own-image-form"]').exists()).toBe(false)
    await openDockerfile(w)
    expect(w.find('[data-testid="dockerfile-editor"]').attributes('readonly')).toBeDefined()
    expect(w.find('[data-testid="dockerfile-save"]').exists()).toBe(false)
    w.unmount()
  })
})
