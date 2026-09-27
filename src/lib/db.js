/**
 * IndexedDB 래퍼. 네트워크 없이 폰 로컬에만 데이터를 저장한다.
 *  - sounds   : 사용자가 추가한 음향 파일(Blob) + 메타데이터
 *  - projects : 타이머 프로젝트(이름, 기본 소리, 시간 목록)
 */
const DB_NAME = 'singing-bowl'
const DB_VERSION = 1

export const SOUNDS = 'sounds'
export const PROJECTS = 'projects'

let dbPromise = null

export function openDB() {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('이 브라우저에서는 로컬 저장소(IndexedDB)를 사용할 수 없습니다.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SOUNDS)) db.createObjectStore(SOUNDS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' })
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => reject(request.error ?? new Error('데이터베이스를 열 수 없습니다.'))
  })

  return dbPromise
}

function request2promise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('저장이 취소되었습니다.'))
  })
}

export async function getAll(storeName) {
  const db = await openDB()
  const store = db.transaction(storeName, 'readonly').objectStore(storeName)
  return request2promise(store.getAll())
}

export async function getOne(storeName, key) {
  const db = await openDB()
  const store = db.transaction(storeName, 'readonly').objectStore(storeName)
  return request2promise(store.get(key))
}

export async function putOne(storeName, value) {
  const db = await openDB()
  const transaction = db.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).put(value)
  await transactionDone(transaction)
  return value
}

export async function putMany(storeName, values) {
  if (!values.length) return values
  const db = await openDB()
  const transaction = db.transaction(storeName, 'readwrite')
  const store = transaction.objectStore(storeName)
  for (const value of values) store.put(value)
  await transactionDone(transaction)
  return values
}

export async function deleteOne(storeName, key) {
  const db = await openDB()
  const transaction = db.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).delete(key)
  await transactionDone(transaction)
}

export async function clearStore(storeName) {
  const db = await openDB()
  const transaction = db.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).clear()
  await transactionDone(transaction)
}

/** 저장 공간 사용량 */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return null
  }
}

/** iOS가 저장 공간을 임의로 비우지 않도록 영구 저장을 요청한다. */
export async function persistStorage() {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
