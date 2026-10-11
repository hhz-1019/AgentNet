import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  absoluteStrokeWidth?: boolean;
};
// SVG only provides sizing/accessibility; the visible artwork is AI-generated PNG.
function generatedIcon(name: string) {
  return function Icon({
    size = 24,
    className = '',
    absoluteStrokeWidth: _absoluteStrokeWidth,
    ...props
  }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 128 128"
        aria-hidden="true"
        focusable="false"
        {...props}
        className={('ew-generated-icon ' + className).trim()}
        data-icon={name}
      >
        <image
          href={'/icons/elsewhere/' + name + '.png'}
          width="128"
          height="128"
        />
      </svg>
    );
  };
}
export const Activity = generatedIcon('Activity');
export const ArrowDownLeft = generatedIcon('ArrowDownLeft');
export const ArrowLeft = generatedIcon('ArrowLeft');
export const ArrowRight = generatedIcon('ArrowRight');
export const ArrowUpRight = generatedIcon('ArrowUpRight');
export const BadgeCheck = generatedIcon('BadgeCheck');
export const BookOpen = generatedIcon('BookOpen');
export const Bookmark = generatedIcon('Bookmark');
export const Bot = generatedIcon('Bot');
export const Check = generatedIcon('Check');
export const ChevronDown = generatedIcon('ChevronDown');
export const ChevronLeft = generatedIcon('ChevronLeft');
export const ChevronRight = generatedIcon('ChevronRight');
export const CloudSun = generatedIcon('CloudSun');
export const Compass = generatedIcon('Compass');
export const Copy = generatedIcon('Copy');
export const ExternalLink = generatedIcon('ExternalLink');
export const Eye = generatedIcon('Eye');
export const FileText = generatedIcon('FileText');
export const Globe2 = generatedIcon('Globe2');
export const Hash = generatedIcon('Hash');
export const Heart = generatedIcon('Heart');
export const History = generatedIcon('History');
export const Image = generatedIcon('Image');
export const LoaderCircle = generatedIcon('LoaderCircle');
export const LockKeyhole = generatedIcon('LockKeyhole');
export const LogOut = generatedIcon('LogOut');
export const MessageCircle = generatedIcon('MessageCircle');
export const Moon = generatedIcon('Moon');
export const Pause = generatedIcon('Pause');
export const Play = generatedIcon('Play');
export const Plus = generatedIcon('Plus');
export const RefreshCw = generatedIcon('RefreshCw');
export const Search = generatedIcon('Search');
export const Send = generatedIcon('Send');
export const Settings2 = generatedIcon('Settings2');
export const Shield = generatedIcon('Shield');
export const ShieldCheck = generatedIcon('ShieldCheck');
export const Sun = generatedIcon('Sun');
export const Trash2 = generatedIcon('Trash2');
export const UserPlus = generatedIcon('UserPlus');
export const UserRound = generatedIcon('UserRound');
export const Users = generatedIcon('Users');
export const Video = generatedIcon('Video');
export const X = generatedIcon('X');
