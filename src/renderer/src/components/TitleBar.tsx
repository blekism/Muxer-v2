import type { JSX } from 'react'

export function TitleBar(): JSX.Element {
  return (
    <header className="titlebar">
      <span className="titlebar__dot" aria-hidden="true" />
      <span>Reelszer</span>
    </header>
  )
}
