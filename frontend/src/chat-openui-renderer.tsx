import { useState } from 'react'
import type { ReactNode } from 'react'
import { createLibrary, Renderer } from '@openuidev/react-lang'
import { Chart } from '@openuidev/intelligent-ui-library/dist/lib/Chart/index.mjs'
import { Table } from '@openuidev/intelligent-ui-library/dist/lib/Table/index.mjs'
import { ThemeProvider } from '@openuidev/intelligent-ui-library/dist/components/ThemeProvider/ThemeProvider.mjs'

const library = createLibrary({
  id: 'pythera-analysis',
  components: [Chart, Table],
})

const theme = {
  intelligentFont: '"Inter Variable", Inter, system-ui, sans-serif',
  intelligentChart1: '#00866e',
  intelligentChart2: '#53b8a5',
  intelligentChart3: '#87c8bd',
  intelligentChart4: '#5486ad',
  intelligentChart5: '#d8a85b',
  intelligentChart6: '#8b7da8',
}

type RenderProps = { program: string; fallback: ReactNode }

export default function OpenUiResult({ program, fallback }: RenderProps) {
  const [failed, setFailed] = useState(false)
  if (failed) return fallback
  return <ThemeProvider mode="light" lightTheme={theme}>
    <Renderer response={program} library={library} isStreaming={false}
      onError={errors => { if (errors.some(error => error.severity !== 'warning')) setFailed(true) }} />
  </ThemeProvider>
}
