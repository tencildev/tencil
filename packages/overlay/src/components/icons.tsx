import type { ComponentChildren } from 'preact';

/** Lucide-style 24px stroke icons, inlined so the overlay has no asset requests. */
function Icon({ children, size = 16 }: { children: ComponentChildren; size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

export const CommentIcon = () => (
    <Icon>
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        <path d="M12 8v8M8 12h8" />
    </Icon>
);

export const InboxIcon = () => (
    <Icon>
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </Icon>
);

export const EyeOffIcon = () => (
    <Icon>
        <path d="M10.7 5.1A10.8 10.8 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7" />
        <path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
        <path d="M9.9 9.9a3 3 0 1 0 4.2 4.2M2 2l20 20" />
    </Icon>
);

export const EyeIcon = () => (
    <Icon>
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
    </Icon>
);

export const ArrowUpIcon = () => (
    <Icon>
        <path d="m5 12 7-7 7 7M12 19V5" />
    </Icon>
);

export const StopIcon = () => (
    <Icon size={12}>
        <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
    </Icon>
);

export const CheckIcon = () => (
    <Icon>
        <path d="M20 6 9 17l-5-5" />
    </Icon>
);

export const UndoIcon = () => (
    <Icon>
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Icon>
);

export const TrashIcon = () => (
    <Icon>
        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Icon>
);

export const ExternalIcon = () => (
    <Icon size={14}>
        <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Icon>
);

export const CloseIcon = () => (
    <Icon>
        <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
);

export const CameraIcon = () => (
    <Icon size={14}>
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
        <circle cx="12" cy="13" r="3" />
    </Icon>
);

export const CodeIcon = () => (
    <Icon size={12}>
        <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
    </Icon>
);

export const SettingsIcon = () => (
    <Icon>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
    </Icon>
);

/**
 * Tencil's mark, as on tencil.dev: the overlay's pin with a cursor cut out of it, so
 * the background shows through. Drawn on a 128 grid with a 3/24 margin.
 */
export const TencilLogo = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" class="tencil-logo">
        <path
            d="M80 0C106.51 0 128 21.4903 128 48V80C128 106.51 106.51 128 80 128H4C1.79086 128 0 126.209 0 124V48C0 21.4903 21.4903 0 48 0H80ZM102.06 31.19A4 4 0 0 0 96.81 25.94L17.67 59.86A4 4 0 0 0 17.98 67.33L48.1 77.37A4 4 0 0 1 50.63 79.9L60.67 110.02A4 4 0 0 0 68.14 110.33Z"
            transform="translate(3 3) scale(0.140625)"
            fill="#3b62ff"
            fill-rule="evenodd"
        />
    </svg>
);

export const LayersIcon = () => (
    <Icon size={14}>
        <path d="m12 2 10 5-10 5L2 7Z" />
        <path d="m2 17 10 5 10-5M2 12l10 5 10-5" />
    </Icon>
);

export const RulerIcon = () => (
    <Icon>
        <rect x="2" y="7" width="20" height="10" rx="2" />
        <path d="M6 7v3M10 7v4M14 7v3M18 7v4" />
    </Icon>
);

/** The ruler, struck through: measuring is off. */
export const RulerOffIcon = () => (
    <Icon>
        <rect x="2" y="7" width="20" height="10" rx="2" />
        <path d="M6 7v3M10 7v4M14 7v3M18 7v4M3 3l18 18" />
    </Icon>
);

export const ChevronIcon = () => (
    <Icon size={12}>
        <path d="m6 9 6 6 6-6" />
    </Icon>
);
