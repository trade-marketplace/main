"use client";
import { ChipGroup } from "@/components/forms/ChoiceFields";
import { TextAreaField } from "@/components/forms/TextFields";
import { StarInput } from "@/components/media/Stars";
import { SIGNOFF_REVIEW_TAGS } from "@/lib/customer-signoff";

const tags = SIGNOFF_REVIEW_TAGS.map(value => ({ value, label: value }));
export function ReviewFields({ name, workerName, rating, onRating, selectedTags, onTags, comment, onComment, hideUntilRated = false, starsClassName, tagsClassName }: {
  name: string; workerName: string; rating: number | null; onRating: (rating: number) => void; selectedTags: string[]; onTags: (tags: string[]) => void;
  comment: string; onComment: (comment: string) => void; hideUntilRated?: boolean; starsClassName?: string; tagsClassName?: string;
}) {
  return <>
    <StarInput name={name} value={rating} onChange={onRating} label={`Rate ${workerName}`} className={starsClassName} />
    {(!hideUntilRated || rating !== null) && <ChipGroup label="Review tags" hideLabel multiple value={selectedTags} onChange={onTags} options={tags} disabled={rating === null} className={tagsClassName} />}
    {rating !== null && <TextAreaField label="Add a comment (optional)" value={comment} onChange={event => onComment(event.target.value)} maxLength={1000} rows={3} />}
  </>;
}
