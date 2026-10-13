import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  ListChecks as ActivityGlyph,
  ArrowDownLeft as ArrowDownLeftGlyph,
  ArrowLeft as ArrowLeftGlyph,
  ArrowRight as ArrowRightGlyph,
  ArrowUpRight as ArrowUpRightGlyph,
  BadgeCheck as BadgeCheckGlyph,
  BookOpen as BookOpenGlyph,
  Bookmark as BookmarkGlyph,
  Bot as BotGlyph,
  Check as CheckGlyph,
  ChevronDown as ChevronDownGlyph,
  ChevronLeft as ChevronLeftGlyph,
  ChevronRight as ChevronRightGlyph,
  CloudSun as CloudSunGlyph,
  Compass as CompassGlyph,
  Copy as CopyGlyph,
  ExternalLink as ExternalLinkGlyph,
  Eye as EyeGlyph,
  FileText as FileTextGlyph,
  Globe2 as Globe2Glyph,
  Hash as HashGlyph,
  Heart as HeartGlyph,
  History as HistoryGlyph,
  Image as ImageGlyph,
  LoaderCircle as LoaderCircleGlyph,
  LockKeyhole as LockKeyholeGlyph,
  LogOut as LogOutGlyph,
  MessageCircle as MessageCircleGlyph,
  Moon as MoonGlyph,
  Pause as PauseGlyph,
  Play as PlayGlyph,
  Plus as PlusGlyph,
  RefreshCw as RefreshCwGlyph,
  Search as SearchGlyph,
  Send as SendGlyph,
  Settings2 as Settings2Glyph,
  Shield as ShieldGlyph,
  ShieldCheck as ShieldCheckGlyph,
  Sun as SunGlyph,
  Trash2 as Trash2Glyph,
  UserPlus as UserPlusGlyph,
  UserRound as UserRoundGlyph,
  Users as UsersGlyph,
  Video as VideoGlyph,
  X as XGlyph,
  Snowflake as SnowflakeGlyph,
} from 'lucide-react';
import './icons.css';

// Familiar silhouettes remain identical in every theme; only their semantic
// palette changes. Vector strokes stay crisp in small controls and at zoom.
function themedIcon(name: string, Glyph: LucideIcon) {
  return function Icon({
    className = '',
    strokeWidth = 1.9,
    ...props
  }: LucideProps) {
    return (
      <Glyph
        aria-hidden="true"
        focusable="false"
        strokeWidth={strokeWidth}
        {...props}
        className={('ew-icon ' + className).trim()}
        data-icon={name}
      />
    );
  };
}
export const Activity = themedIcon('Activity', ActivityGlyph);
export const ArrowDownLeft = themedIcon('ArrowDownLeft', ArrowDownLeftGlyph);
export const ArrowLeft = themedIcon('ArrowLeft', ArrowLeftGlyph);
export const ArrowRight = themedIcon('ArrowRight', ArrowRightGlyph);
export const ArrowUpRight = themedIcon('ArrowUpRight', ArrowUpRightGlyph);
export const BadgeCheck = themedIcon('BadgeCheck', BadgeCheckGlyph);
export const BookOpen = themedIcon('BookOpen', BookOpenGlyph);
export const Bookmark = themedIcon('Bookmark', BookmarkGlyph);
export const Bot = themedIcon('Bot', BotGlyph);
export const Check = themedIcon('Check', CheckGlyph);
export const ChevronDown = themedIcon('ChevronDown', ChevronDownGlyph);
export const ChevronLeft = themedIcon('ChevronLeft', ChevronLeftGlyph);
export const ChevronRight = themedIcon('ChevronRight', ChevronRightGlyph);
export const CloudSun = themedIcon('CloudSun', CloudSunGlyph);
export const Compass = themedIcon('Compass', CompassGlyph);
export const Copy = themedIcon('Copy', CopyGlyph);
export const ExternalLink = themedIcon('ExternalLink', ExternalLinkGlyph);
export const Eye = themedIcon('Eye', EyeGlyph);
export const FileText = themedIcon('FileText', FileTextGlyph);
export const Globe2 = themedIcon('Globe2', Globe2Glyph);
export const Hash = themedIcon('Hash', HashGlyph);
export const Heart = themedIcon('Heart', HeartGlyph);
export const History = themedIcon('History', HistoryGlyph);
export const Image = themedIcon('Image', ImageGlyph);
export const LoaderCircle = themedIcon('LoaderCircle', LoaderCircleGlyph);
export const LockKeyhole = themedIcon('LockKeyhole', LockKeyholeGlyph);
export const LogOut = themedIcon('LogOut', LogOutGlyph);
export const MessageCircle = themedIcon('MessageCircle', MessageCircleGlyph);
export const Moon = themedIcon('Moon', MoonGlyph);
export const Pause = themedIcon('Pause', PauseGlyph);
export const Play = themedIcon('Play', PlayGlyph);
export const Plus = themedIcon('Plus', PlusGlyph);
export const RefreshCw = themedIcon('RefreshCw', RefreshCwGlyph);
export const Search = themedIcon('Search', SearchGlyph);
export const Send = themedIcon('Send', SendGlyph);
export const Settings2 = themedIcon('Settings2', Settings2Glyph);
export const Shield = themedIcon('Shield', ShieldGlyph);
export const ShieldCheck = themedIcon('ShieldCheck', ShieldCheckGlyph);
export const Sun = themedIcon('Sun', SunGlyph);
export const Trash2 = themedIcon('Trash2', Trash2Glyph);
export const UserPlus = themedIcon('UserPlus', UserPlusGlyph);
export const UserRound = themedIcon('UserRound', UserRoundGlyph);
export const Users = themedIcon('Users', UsersGlyph);
export const Video = themedIcon('Video', VideoGlyph);
export const X = themedIcon('X', XGlyph);
export const Snowflake = themedIcon('Snowflake', SnowflakeGlyph);
