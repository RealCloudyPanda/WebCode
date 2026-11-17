import type { ProjectSummary } from '@webcode/shared';
import { ProjectCard } from './ProjectCard';

type Props = {
  projects: ProjectSummary[];
  onRename: (p: ProjectSummary, title: string) => void;
  onRemove: (p: ProjectSummary) => void;
};

export function ProjectGrid({ projects, onRename, onRemove }: Props) {
  return (
    <div className="grid">
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} onRename={(t) => onRename(p, t)} onRemove={() => onRemove(p)} />
      ))}
    </div>
  );
}
