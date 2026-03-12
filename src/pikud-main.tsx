import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ProjectModal } from './App'
import { PROJECTS } from './projects'

const pikudProject = PROJECTS.find((p) => p.id === 'pikud-haoled')

function PikudApp() {
  if (!pikudProject) return null

  const handleClose = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/'
    }
  }

  return <ProjectModal project={pikudProject} onClose={handleClose} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PikudApp />
  </StrictMode>,
)

