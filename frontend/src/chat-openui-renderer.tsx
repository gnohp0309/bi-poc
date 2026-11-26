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
  intelligentFont: '"DM Sans", Arial, sans-serif',
  intelligentChart1: '#446c5b',
  intelligentChart2: '#9bb4a5',
  intelligentChart3: '#cfb889',
  intelligentChart4: '#899db1',
  intelligentChart5: '#b99182',
  intelligentChart6: '#a69ab3',
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
