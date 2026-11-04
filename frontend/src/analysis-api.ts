import { api } from './api'

export type AnalysisAggregate = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'count_distinct'
export type AnalysisTimeGrain = 'day' | 'month' | 'year'
export type AnalysisOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is_null' | 'is_not_null'
export type AnalysisValue = string | number | boolean | null

export type DatasetMetadata = {
  datasetId: string
  name: string
  kind: 'PHYSICAL' | 'VIRTUAL'
  columns: {
    name: string
    label: string
    type: string
    kind: 'number' | 'date' | 'text' | 'boolean' | 'other'
    nullable: boolean
    aggregates: AnalysisAggregate[]
    timeGrains: AnalysisTimeGrain[]
  }[]
  limits: {
    maxGroups: number
    maxMetrics: number
    maxFilters: number
    maxResultRows: number
    queryTimeoutSeconds: number
    filterOperators: AnalysisOperator[]
  }
}

export type DatasetAnalysisRequest = {
  groupBy?: { column: string; timeGrain?: AnalysisTimeGrain; alias?: string }[]
  metrics: { column: string; aggregate: AnalysisAggregate; alias: string }[]
  filters?: (
    | { column: string; operator: 'is_null' | 'is_not_null'; value?: null }
    | { column: string; operator: 'in'; value: Exclude<AnalysisValue, null>[] }
    | { column: string; operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; value: Exclude<AnalysisValue, null> }
  )[]
  orderBy?: { column: string; direction: 'asc' | 'desc' }[]
  limit?: number
}

export type DatasetAnalysisResult = {
  datasetId: string
  columns: string[]
  rows: Record<string, AnalysisValue>[]
  rowCount: number
  rowLimit: number
  truncated: boolean
}

export const getDatasetMetadata = (datasetId: string) =>
  api<DatasetMetadata>(`/datasets/${encodeURIComponent(datasetId)}/metadata`)

export const analyzeDataset = (datasetId: string, request: DatasetAnalysisRequest) =>
  api<DatasetAnalysisResult>(`/datasets/${encodeURIComponent(datasetId)}/analyze`, 'POST', request)
