/**
 * Region 定位 — 步骤生成器
 *
 * 动画展示 Client 如何定位 RowKey 所属 Region 及 RegionServer：
 *  - Client 首次定位 → 查 hbase:meta 表（存所有 region 的 location）
 *  - 缓存 meta 信息到 metaCache
 *  - 缓存未命中 → 重新查 meta
 *  - 三级定位链路：ZK(/hbase/meta) → Meta RegionServer → hbase:meta 表 → 目标 RS
 *  - region 迁移后缓存失效，需重新定位
 */
import type { Step, VisualElement, VariableState } from '../types'

/** Region 定位伪代码 */
export const TEMPLATE_CODE = `// Client 定位 RowKey 所属 Region（三级定位）
RegionLocations loc = conn.locateRegion(tableName, rowKey);

// 1. 先查本地 metaCache
if (metaCache.get(rowKey) == null) {
    // 2. 缓存未命中：通过三级链路查 hbase:meta
    //    ZK(/hbase/meta) -> Meta RS -> scan hbase:meta
    MetaRow row = scanMeta(tableName, rowKey);
    metaCache.put(rowKey, row.getServer());
}
return metaCache.get(rowKey);  // 命中目标 RegionServer`

// 画布布局常量
const LAYOUT = {
  client: { x: 60, y: 210, w: 130, h: 70, label: 'Client' },
  zk: { x: 270, y: 60, w: 150, h: 65, label: 'ZooKeeper' },
  metaRs: { x: 270, y: 210, w: 170, h: 70, label: 'Meta RegionServer' },
  metaTable: { x: 490, y: 210, w: 180, h: 90, label: 'hbase:meta' },
  targetRs: { x: 740, y: 210, w: 170, h: 70, label: 'Target RegionServer' },
  cache: { x: 60, y: 320, w: 130, h: 60, label: 'metaCache' },
}

function makeElements(highlight?: string, overrides: Record<string, Partial<VisualElement>> = {}): VisualElement[] {
  const mk = (key: keyof typeof LAYOUT, type: string, state: string): VisualElement => {
    const l = LAYOUT[key]
    return {
      id: key,
      type,
      label: l.label,
      x: l.x,
      y: l.y,
      width: l.w,
      height: l.h,
      state: key === highlight ? 'active' : state,
    }
  }
  const base: VisualElement[] = [
    mk('client', 'client', 'idle'),
    mk('zk', 'zk', 'idle'),
    mk('metaRs', 'rs', 'idle'),
    mk('metaTable', 'table', 'idle'),
    mk('targetRs', 'rs', 'idle'),
    mk('cache', 'cache', 'idle'),
  ]
  return base.map((e) => (overrides[e.id] ? { ...e, ...overrides[e.id] } : e))
}

export function generateSteps(): Step[] {
  const steps: Step[] = []
  let idx = 0

  const push = (
    desc: string,
    line: number,
    vars: VariableState[],
    elements: VisualElement[],
    arrows: { from: string; to: string; label?: string }[] = [],
    actionLabel?: string,
    statusText?: string
  ) => {
    steps.push({
      index: idx++,
      description: desc,
      currentLine: line,
      variables: vars,
      elements,
      connections: arrows.map((a, i) => ({
        id: `arrow-${i}`,
        fromId: a.from,
        toId: a.to,
        kind: 'arrow' as const,
        label: a.label,
      })),
      annotations: [],
      actionLabel,
      statusText: statusText ?? desc,
    })
  }

  // 步骤 0：定位总览
  push(
    'Client 定位 RowKey 所属 Region：先查本地缓存，未命中走三级链路查 hbase:meta',
    1,
    [
      { name: 'tableName', value: '"mytable"', line: 1, type: 'TableName' },
      { name: 'rowKey', value: '"row-42"', line: 1 },
    ],
    makeElements(),
    [
      { from: 'client', to: 'cache', label: '查缓存' },
      { from: 'client', to: 'zk', label: '三级定位' },
    ],
    'OVERVIEW',
    'Region 定位总览'
  )

  // 步骤 1：查 metaCache 缓存未命中
  push(
    'Client 先查 metaCache：row-42 无记录，缓存未命中（cacheHit=false）',
    4,
    [
      { name: 'cacheHit', value: 'false', line: 4, type: 'boolean' },
      { name: 'metaCache.get', value: 'null', line: 4 },
    ],
    makeElements('cache', {
      cache: { state: 'active', subLabel: 'miss (row-42)' },
    }),
    [{ from: 'client', to: 'cache', label: '1.查缓存' }],
    'CACHE_MISS',
    '缓存未命中'
  )

  // 步骤 2：三级定位 - ZK
  push(
    '三级定位第 1 跳：Client 查 ZK 的 /hbase/meta 节点，获取 meta 所在 RS',
    6,
    [
      { name: 'zkNode', value: '/hbase/meta', line: 6 },
      { name: 'metaRs', value: 'Meta-RS', line: 6 },
    ],
    makeElements('zk', {
      zk: { state: 'active', subLabel: '/hbase/meta' },
    }),
    [{ from: 'client', to: 'zk', label: '2.查 /hbase/meta' }],
    'ZK',
    '查 ZK 定位 meta RS'
  )

  // 步骤 3：三级定位 - Meta RS
  push(
    '三级定位第 2 跳：连接 Meta RegionServer，准备扫描 hbase:meta 表',
    6,
    [
      { name: 'metaRs', value: 'server-3:16020', line: 6, type: 'ServerName' },
    ],
    makeElements('metaRs', {
      zk: { state: 'idle', subLabel: '/hbase/meta' },
      metaRs: { state: 'active', subLabel: '持有 hbase:meta' },
    }),
    [{ from: 'zk', to: 'metaRs', label: 'meta RS' }],
    'META_RS',
    '连接 Meta RegionServer'
  )

  // 步骤 4：扫描 hbase:meta
  push(
    '三级定位第 3 跳：扫描 hbase:meta，按 rowKey 范围找到目标 region 的 location',
    7,
    [
      { name: 'metaTable', value: 'hbase:meta', line: 7, type: 'TableName' },
      { name: 'MetaRow', value: 'table,,1 @ RS-2', line: 7 },
      { name: 'serverName', value: 'RS-2', line: 7, type: 'ServerName' },
      { name: 'regionName', value: 'table,,1', line: 7 },
    ],
    makeElements('metaTable', {
      metaRs: { state: 'active', subLabel: '持有 hbase:meta' },
      metaTable: { state: 'active', subLabel: 'row-42 → RS-2' },
    }),
    [{ from: 'metaRs', to: 'metaTable', label: '3.scan meta' }],
    'SCAN_META',
    '扫描 hbase:meta 表'
  )

  // 步骤 5：写入 metaCache
  push(
    '把定位结果写入 metaCache，后续访问同 region 直接命中缓存（cacheHit=true）',
    8,
    [
      { name: 'metaCache.put', value: 'row-42 → RS-2', line: 8 },
      { name: 'cacheHit', value: 'true', line: 8, type: 'boolean' },
    ],
    makeElements('cache', {
      metaTable: { state: 'active', subLabel: 'row-42 → RS-2' },
      cache: { state: 'active', subLabel: 'put(row-42, RS-2)' },
    }),
    [{ from: 'metaTable', to: 'cache', label: '缓存结果' }],
    'CACHE_PUT',
    '缓存定位结果'
  )

  // 步骤 6：命中目标 RS
  push(
    '缓存命中返回目标 RegionServer RS-2，Client 直接向其发起读写',
    9,
    [
      { name: 'metaCache.get', value: 'RS-2', line: 9, type: 'ServerName' },
      { name: 'regionName', value: 'table,,1', line: 9 },
    ],
    makeElements('targetRs', {
      cache: { state: 'active', subLabel: 'hit: RS-2' },
      targetRs: { state: 'active', subLabel: 'RS-2 region table,,1' },
    }),
    [{ from: 'client', to: 'targetRs', label: '4.读写' }],
    'LOCATED',
    '命中目标 RS-2'
  )

  // 步骤 7：region 迁移后缓存失效
  push(
    'region 迁移后（table,,1 从 RS-2 → RS-5）：Client 收到 NotServingRegion，缓存失效',
    4,
    [
      { name: 'cacheHit', value: 'false (失效)', line: 4, type: 'boolean' },
      { name: 'newServer', value: 'RS-5', line: 9, type: 'ServerName' },
      { name: 'exception', value: 'NotServingRegionException', line: 4 },
    ],
    makeElements('targetRs', {
      cache: { state: 'deleted', subLabel: '失效 (旧:RS-2)' },
      targetRs: { state: 'active', subLabel: '已迁移 → RS-5', label: 'Target RS (RS-5)' },
    }),
    [{ from: 'targetRs', to: 'cache', label: '缓存失效' }],
    'INVALIDATE',
    '迁移后缓存失效'
  )

  // 步骤 8：重新定位
  push(
    'Client 清除旧缓存，重新走三级定位链路，获取最新 location（RS-5）并刷新缓存',
    6,
    [
      { name: 'metaCache.get', value: 'RS-5', line: 9, type: 'ServerName' },
      { name: 'cacheHit', value: 'true (刷新)', line: 8 },
    ],
    makeElements('targetRs', {
      cache: { state: 'active', subLabel: 'hit: RS-5' },
      targetRs: { state: 'done', subLabel: 'RS-5 region table,,1', label: 'Target RS (RS-5)' },
    }),
    [{ from: 'client', to: 'targetRs', label: '重新读写' }],
    'RELOCATE',
    '重新定位完成'
  )

  return steps
}
