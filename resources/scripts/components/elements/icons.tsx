import React from 'react';
import {
    Archive,
    ArrowLeft,
    Cable,
    CalendarDays,
    Check,
    ChevronDown,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    CircleArrowDown,
    CircleX,
    ClipboardList,
    Clock,
    CloudDownload,
    CloudUpload,
    Code,
    Copy,
    CornerLeftUp,
    Cpu,
    Database,
    Ellipsis,
    ExternalLink,
    Eye,
    File,
    FileArchive,
    FileCode,
    FileDown,
    FileInput,
    FilePlus,
    FileText,
    Folder,
    FolderOpen,
    FolderPlus,
    HardDrive,
    KeyRound,
    Layers,
    Lock,
    LockOpen,
    LucideIcon,
    Menu,
    MemoryStick,
    Monitor,
    Network,
    PackageOpen,
    Pencil,
    RefreshCw,
    Search,
    Server,
    Terminal,
    ToggleRight,
    Trash2,
    TriangleAlert,
    Upload,
    Wifi,
    X,
} from 'lucide-react';

// The one interface icon set of the Panel is Lucide. This module keeps the names the older components were written
// against (Font Awesome style `faX` constants and the `FontAwesomeIcon` element) and resolves them to Lucide icons, so
// nothing on screen is drawn from any other icon set.
export type IconDefinition = LucideIcon;

export const faAngleDoubleLeft = ChevronsLeft;
export const faAngleDoubleRight = ChevronsRight;
export const faArchive = Archive;
export const faArrowCircleDown = CircleArrowDown;
export const faArrowLeft = ArrowLeft;
export const faBars = Menu;
export const faBoxOpen = PackageOpen;
export const faCalendarAlt = CalendarDays;
export const faCheck = Check;
export const faChevronDown = ChevronDown;
export const faChevronRight = ChevronRight;
export const faClock = Clock;
export const faCloudDownloadAlt = CloudDownload;
export const faCloudUploadAlt = CloudUpload;
export const faCode = Code;
export const faCopy = Copy;
export const faDatabase = Database;
export const faEllipsisH = Ellipsis;
export const faEthernet = Cable;
export const faExclamationTriangle = TriangleAlert;
export const faExternalLinkAlt = ExternalLink;
export const faEye = Eye;
export const faFile = File;
export const faFileAlt = FileText;
export const faFileArchive = FileArchive;
export const faFileCode = FileCode;
export const faFileDownload = FileDown;
export const faFileImport = FileInput;
export const faFileMedical = FilePlus;
export const faFolder = Folder;
export const faFolderOpen = FolderOpen;
export const faFolderPlus = FolderPlus;
export const faHdd = HardDrive;
export const faKey = KeyRound;
export const faLayerGroup = Layers;
export const faLevelUpAlt = CornerLeftUp;
export const faLock = Lock;
export const faMemory = MemoryStick;
export const faMicrochip = Cpu;
export const faNetworkWired = Network;
export const faPencilAlt = Pencil;
export const faSearch = Search;
export const faServer = Server;
export const faSyncAlt = RefreshCw;
export const faTimes = X;
export const faToggleOn = ToggleRight;
export const faTrashAlt = Trash2;
export const faUnlock = LockOpen;
export const faUpload = Upload;
export const faWifi = Wifi;

// Names from the heroicons set that a few components still use.
export const ChevronDoubleLeftIcon = ChevronsLeft;
export const ChevronDoubleRightIcon = ChevronsRight;
export const ChevronDownIcon = ChevronDown;
export const ClipboardListIcon = ClipboardList;
export const CloudDownloadIcon = CloudDownload;
export const CloudUploadIcon = CloudUpload;
export const DesktopComputerIcon = Monitor;
export const FolderOpenIcon = FolderOpen;
export const TerminalIcon = Terminal;
export const XCircleIcon = CircleX;
export const XIcon = X;

const SIZES: Record<string, string> = {
    xs: '0.75em',
    sm: '0.875em',
    lg: '1.33em',
    '2x': '2em',
    '3x': '3em',
    '4x': '4em',
};

interface Props extends Omit<React.SVGProps<SVGSVGElement>, 'ref' | 'size'> {
    icon: LucideIcon;
    // Fixed width columns, as in Font Awesome.
    fixedWidth?: boolean;
    size?: string;
    color?: string;
    spin?: boolean;
}

/** A Lucide icon drawn inline with the surrounding text (1em), with the props the older call sites pass. */
export const FontAwesomeIcon = ({ icon: Icon, fixedWidth, size, color, spin, style, ...rest }: Props) => {
    const dimension = size ? SIZES[size] || size : '1em';

    return (
        <Icon
            aria-hidden
            width={fixedWidth ? '1.25em' : dimension}
            height={dimension}
            color={color}
            className={spin ? 'fa-spin' : undefined}
            style={{ display: 'inline-block', verticalAlign: '-0.15em', flex: 'none', ...style }}
            {...(rest as object)}
        />
    );
};
