/**
 * 앱 상태(프로젝트 / 사용자 소리)와 IndexedDB 영속화.
 * 모든 데이터는 폰 로컬(IndexedDB)에만 저장된다.
 */
import * as db from './db.js'
import { DEFAULT_SOUND_ID, BUILTIN_SOUNDS, builtinSound } from './synth.js'
import { evictBuffer, probeAudio } from './sound-loader.js'
import { getAudioContext } from './audio-session.js'
import { stripExtension, uid } from './time.js'

const AUDIO_EXTENSIONS = /\.(mp3|m4a|mp4|aac|wav|wave|aif|aiff|caf|ogg|oga|opus|flac|webm)$/i

export function isAudioFile(file) {
  if (file.type?.startsWith('audio/')) return true
  return AUDIO_EXTENSIONS.test(file.name ?? '')
}

function normalizeCue(cue) {
  return {
    id: cue?.id ?? uid('cue'),
    atSeconds: Math.max(0, Math.round(cue?.atSeconds ?? 0)),
    soundId: cue?.soundId ?? null,
    label: cue?.label ?? '',
  }
}

function normalizeProject(project) {
  const now = Date.now()
  return {
    id: project?.id ?? uid('project'),
    name: project?.name?.trim() || '이름 없는 프로젝트',
    defaultSoundId: project?.defaultSoundId ?? DEFAULT_SOUND_ID,
    volume: typeof project?.volume === 'number' ? Math.min(1, Math.max(0, project.volume)) : 0.9,
    cues: Array.isArray(project?.cues)
      ? project.cues
          .map(normalizeCue)
          .sort((a, b) => a.atSeconds - b.atSeconds || a.id.localeCompare(b.id))
      : [],
    createdAt: project?.createdAt ?? now,
    updatedAt: project?.updatedAt ?? now,
  }
}

function createProject(name, { cues, defaultSoundId } = {}) {
  const now = Date.now()
  return {
    id: uid('project'),
    name: name?.trim() || '새 프로젝트',
    defaultSoundId: defaultSoundId ?? DEFAULT_SOUND_ID,
    volume: 0.9,
    cues: (cues ?? [{ atSeconds: 300, soundId: null, label: '' }]).map(normalizeCue),
    createdAt: now,
    updatedAt: now,
  }
}

/** 처음 실행했을 때 넣어 주는 예시 프로젝트 */
function firstRunProjects() {
  return [
    createProject('아침 명상', {
      defaultSoundId: 'builtin:bowl',
      cues: [
        { atSeconds: 300, soundId: null, label: '' },
        { atSeconds: 600, soundId: null, label: '' },
        { atSeconds: 900, soundId: 'builtin:wood', label: '마무리' },
      ],
    }),
  ]
}

const plain = (value) => $state.snapshot(value)

export class AppStore {
  ready = $state(false)
  error = $state(null)
  sounds = $state([])
  projects = $state([])

  /** 내장 소리 + 사용자 소리 */
  get allSounds() {
    return [...BUILTIN_SOUNDS, ...this.sounds]
  }

  get totalCueCount() {
    return this.projects.reduce((sum, project) => sum + project.cues.length, 0)
  }

  projectById(id) {
    return this.projects.find((project) => project.id === id) ?? null
  }

  soundById(soundId) {
    const preset = builtinSound(soundId)
    if (preset) return preset
    return this.sounds.find((sound) => sound.id === soundId) ?? null
  }

  soundName(soundId) {
    return this.soundById(soundId)?.name ?? '알 수 없는 소리'
  }

  async init() {
    if (this.ready) return
    try {
      const [soundRecords, projectRecords] = await Promise.all([
        db.getAll(db.SOUNDS),
        db.getAll(db.PROJECTS),
      ])
      this.sounds = soundRecords
        .map((sound) => ({ ...sound }))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      this.projects = projectRecords
        .map(normalizeProject)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

      if (!this.projects.length) {
        const seeded = firstRunProjects()
        this.projects = seeded
        await db.putMany(db.PROJECTS, seeded.map(plain))
      }
    } catch (error) {
      this.error = error?.message ?? String(error)
    } finally {
      this.ready = true
    }
  }

  /* ------------------------------- 프로젝트 ------------------------------- */

  async createProject(name, preset) {
    const project = createProject(name, preset)
    this.projects = [project, ...this.projects]
    await this.#persistProject(project)
    return project
  }

  async duplicateProject(projectId) {
    const source = this.projectById(projectId)
    if (!source) return null
    const copy = createProject(`${source.name} 복사본`, {
      defaultSoundId: source.defaultSoundId,
      cues: source.cues.map((cue) => ({ ...cue, id: undefined })),
    })
    this.projects = [copy, ...this.projects]
    await this.#persistProject(copy)
    return copy
  }

  /** patch 를 병합하고 저장한다(부분 업데이트). */
  async updateProject(projectId, patch) {
    const project = this.projectById(projectId)
    if (!project) return null
    const next = normalizeProject({ ...plain(project), ...patch, updatedAt: Date.now() })
    Object.assign(project, next)
    await this.#persistProject(project)
    return project
  }

  async deleteProject(projectId) {
    this.projects = this.projects.filter((project) => project.id !== projectId)
    await db.deleteOne(db.PROJECTS, projectId)
  }

  /** 소리 하나가 프로젝트에서 사용되는 횟수(삭제 확인용) */
  usageCount(soundId) {
    let count = 0
    for (const project of this.projects) {
      if (project.defaultSoundId === soundId) count += 1
      for (const cue of project.cues) if (cue.soundId === soundId) count += 1
    }
    return count
  }

  async #persistProject(project) {
    try {
      await db.putOne(db.PROJECTS, plain(project))
    } catch (error) {
      this.error = error?.message ?? String(error)
    }
  }

  /* ---------------------------------- 소리 ---------------------------------- */

  /** 사용자가 고른 음향 파일들을 저장한다. 추가 즉시 디코딩해 형식을 검증한다. */
  async addSoundFiles(fileList) {
    const files = [...fileList]
    const added = []
    const failed = []

    for (const file of files) {
      if (!isAudioFile(file)) {
        failed.push(`${file.name}(지원하지 않는 형식)`)
        continue
      }
      try {
        const arrayBuffer = await file.arrayBuffer()
        const info = await probeAudio(getAudioContext(), arrayBuffer)
        const record = {
          id: uid('sound'),
          name: stripExtension(file.name),
          kind: 'file',
          mime: file.type || 'audio/*',
          size: file.size,
          durationMs: info.durationMs,
          sampleRate: info.sampleRate,
          channels: info.channels,
          blob: file,
          createdAt: Date.now(),
        }
        await db.putOne(db.SOUNDS, record)
        this.sounds = [...this.sounds, record]
        added.push(record)
      } catch (error) {
        failed.push(`${file.name}(${error?.message ?? '해석 실패'})`)
      }
    }

    this.error = failed.length ? `추가하지 못한 파일: ${failed.join(', ')}` : null
    return added
  }

  async renameSound(soundId, name) {
    const sound = this.sounds.find((item) => item.id === soundId)
    if (!sound) return
    const next = name.trim()
    if (!next) return
    sound.name = next
    try {
      await db.putOne(db.SOUNDS, plain(sound))
    } catch (error) {
      this.error = error?.message ?? String(error)
    }
  }

  /** 소리를 삭제하고, 이 소리를 쓰던 프로젝트의 참조를 기본 소리로 되돌린다. */
  async deleteSound(soundId) {
    this.sounds = this.sounds.filter((sound) => sound.id !== soundId)
    evictBuffer(soundId)
    await db.deleteOne(db.SOUNDS, soundId)

    for (const project of this.projects) {
      let changed = false
      if (project.defaultSoundId === soundId) {
        project.defaultSoundId = DEFAULT_SOUND_ID
        changed = true
      }
      for (const cue of project.cues) {
        if (cue.soundId === soundId) {
          cue.soundId = null
          changed = true
        }
      }
      if (changed) {
        project.updatedAt = Date.now()
        await this.#persistProject(project)
      }
    }
  }

  async storageEstimate() {
    return db.storageEstimate()
  }

  async requestPersistence() {
    return db.persistStorage()
  }

  clearError() {
    this.error = null
  }
}

export const store = new AppStore()

