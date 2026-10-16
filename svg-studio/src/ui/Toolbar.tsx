import { groupSelection, setTool, ungroupSelection } from '../state/actions';
import { useEditor, type ToolId } from '../state/store';
import { Icon, type IconName } from './icons';

interface ToolDef {
  id: ToolId;
  icon: IconName;
  label: string;
  key: string;
  hint: string;
}

const GROUPS: ToolDef[][] = [
  [
    { id: 'select', icon: 'select', label: 'Select', key: 'V', hint: 'Click or drag a rectangle to select. Drag handles to resize or rotate.' },
    { id: 'node', icon: 'node', label: 'Edit points', key: 'A', hint: 'Move the points and handles of a path.' },
  ],
  [
    { id: 'pen', icon: 'pen', label: 'Pen', key: 'P', hint: 'Draw paths and curves.' },
    { id: 'line', icon: 'line', label: 'Line', key: 'L', hint: 'Draw a straight line.' },
    { id: 'rect', icon: 'rect', label: 'Rectangle', key: 'R', hint: 'Draw a rectangle.' },
    { id: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'E', hint: 'Draw an ellipse or circle.' },
  ],
  [
    { id: 'scale', icon: 'scale', label: 'Scale (both)', key: 'S', hint: 'Drag to scale the selection both ways about its pivot.' },
    { id: 'scaleH', icon: 'scaleH', label: 'Scale horizontally', key: 'X', hint: 'Drag sideways to scale the selection horizontally.' },
    { id: 'scaleV', icon: 'scaleV', label: 'Scale vertically', key: 'Y', hint: 'Drag up or down to scale the selection vertically.' },
    { id: 'rotate', icon: 'rotate', label: 'Rotate', key: 'T', hint: 'Drag around the pivot to rotate the selection.' },
  ],
  [{ id: 'hand', icon: 'hand', label: 'Pan', key: 'H', hint: 'Drag to move the canvas. Hold Space for this with any tool.' }],
];

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  return (
    <nav className="toolbar" aria-label="Tools">
      {GROUPS.map((group, i) => (
        <div className="tool-group" key={i}>
          {group.map((t) => (
            <button key={t.id} type="button" className={`tool ${tool === t.id ? 'on' : ''}`} aria-pressed={tool === t.id} aria-label={t.label} data-tool={t.id} data-testid={`tool-${t.id}`} title={`${t.label} (${t.key}) — ${t.hint}`} onClick={() => setTool(t.id)}>
              <Icon name={t.icon} size={19} />
              <kbd>{t.key}</kbd>
            </button>
          ))}
        </div>
      ))}
      <div className="tool-group">
        <button type="button" className="tool" aria-label="Group" data-testid="tool-group" title="Group the selection (Ctrl+G) so it can be moved and transformed as one" onClick={groupSelection}>
          <Icon name="group" size={19} />
        </button>
        <button type="button" className="tool" aria-label="Ungroup" data-testid="tool-ungroup" title="Ungroup (Ctrl+Shift+G)" onClick={ungroupSelection}>
          <Icon name="ungroup" size={19} />
        </button>
      </div>
    </nav>
  );
}
