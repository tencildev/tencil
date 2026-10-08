import { quickLabel } from '../lib/element-context.ts';
import { hovered, layoutTick, mode } from '../lib/state.ts';

export function Highlight() {
    layoutTick.value;
    const element = hovered.value;
    if (mode.value !== 'picking' || !element) return null;
    const rect = element.getBoundingClientRect();
    const labelBelow = rect.top < 28;
    return (
        <>
            <div
                class="highlight"
                style={{
                    transform: `translate(${rect.left}px, ${rect.top}px)`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                }}
            />
            <div
                class="highlight-label"
                style={{
                    transform: `translate(${Math.max(4, rect.left)}px, ${labelBelow ? rect.bottom + 6 : rect.top - 26}px)`,
                }}
            >
                {quickLabel(element)}
                <span class="highlight-size">
                    {Math.round(rect.width)}×{Math.round(rect.height)}
                </span>
            </div>
        </>
    );
}
