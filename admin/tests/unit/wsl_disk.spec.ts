import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildWsl2StorageDisk, isWsl2Kernel } from '../../app/utils/wsl_disk.js'

type Fs = { fs: string; size: number; used: number; use: number; mount: string }
const fs = (o: Partial<Fs>): Fs => ({
  fs: '/dev/sdf',
  size: 0,
  used: 0,
  use: 0,
  mount: '/x',
  ...o,
})

test('isWsl2Kernel detects the WSL2 microsoft kernel tag', () => {
  assert.equal(isWsl2Kernel('6.6.87.2-microsoft-standard-WSL2'), true)
})

test('isWsl2Kernel is case-insensitive', () => {
  assert.equal(isWsl2Kernel('6.6.87.2-Microsoft-standard-WSL2'), true)
})

test('isWsl2Kernel returns false for a native Linux kernel', () => {
  assert.equal(isWsl2Kernel('5.15.0-91-generic'), false)
})

test('isWsl2Kernel handles a missing kernel string', () => {
  assert.equal(isWsl2Kernel(undefined), false)
  assert.equal(isWsl2Kernel(null), false)
  assert.equal(isWsl2Kernel(''), false)
})

test('buildWsl2StorageDisk builds one disk from the /app/storage filesystem', () => {
  const result = buildWsl2StorageDisk([
    fs({ fs: 'overlay', size: 1081101176832, used: 61235068928, use: 5.97, mount: '/' }),
    fs({
      fs: '/dev/sdf',
      size: 1081101176832,
      used: 438149951488,
      use: 42.7,
      mount: '/app/storage',
    }),
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].name, 'NOMAD Storage')
  assert.equal(result[0].totalSize, 1081101176832)
  assert.equal(result[0].totalUsed, 438149951488)
  assert.equal(result[0].filesystems[0].mount, '/app/storage')
  assert.equal(result[0].filesystems[0].fs, '/dev/sdf')
})

test('buildWsl2StorageDisk uses df capacity (use) for percentUsed, not used/size', () => {
  // ext4 reserves blocks, so df capacity (used/(used+avail)) differs from used/size.
  // Surface df's number to match what `df -h` shows in the WSL terminal.
  const result = buildWsl2StorageDisk([
    fs({ size: 1081101176832, used: 438149951488, use: 42.7, mount: '/app/storage' }),
  ])
  assert.equal(result[0].percentUsed, 42.7)
})

test('buildWsl2StorageDisk ignores the overlay / docker-cache filesystem', () => {
  const result = buildWsl2StorageDisk([
    fs({ fs: 'overlay', size: 1081101176832, used: 61235068928, use: 5.97, mount: '/' }),
  ])
  assert.deepEqual(result, [])
})

test('buildWsl2StorageDisk returns [] when /app/storage has zero size', () => {
  assert.deepEqual(buildWsl2StorageDisk([fs({ size: 0, mount: '/app/storage' })]), [])
})
