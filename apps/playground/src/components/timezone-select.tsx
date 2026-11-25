import { Combobox } from '@base-ui/react/combobox';

const TIMEZONES = ['Europe/Amsterdam', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'UTC'];

/** A searchable select in a popup, like Base UI's combobox: closes on outside presses and blur. */
export function TimezoneSelect() {
    return (
        <Combobox.Root items={TIMEZONES} defaultValue="UTC" autoHighlight>
            <Combobox.Trigger className="button button-ghost" aria-label="Timezone">
                <Combobox.Value />
            </Combobox.Trigger>
            <Combobox.Portal>
                <Combobox.Positioner sideOffset={6} align="start">
                    <Combobox.Popup className="listbox">
                        <Combobox.Input placeholder="Search timezones" />
                        <Combobox.Empty>No matching timezones.</Combobox.Empty>
                        <Combobox.List>
                            {(zone: string) => (
                                <Combobox.Item key={zone} value={zone} className="listbox-item">
                                    {zone}
                                </Combobox.Item>
                            )}
                        </Combobox.List>
                    </Combobox.Popup>
                </Combobox.Positioner>
            </Combobox.Portal>
        </Combobox.Root>
    );
}
