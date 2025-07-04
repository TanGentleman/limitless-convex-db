import { internalQuery, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { contentsNode, lifelogDoc } from './schema';


// Receive batch of lifelogs from API
// Check updatedAt value
// Send to an internalQuery called isLifelogUpdated

// internalQuery accepts an list of (lifelogId, updatedAt) pairs. Return which lifelogs need to be created, updated, or deleted.

const itemsArray = v.array(
  v.object({
    lifelogId: v.string(),
    updatedAt: v.optional(v.number()),
  }),
);

// const resultArray = v.object({
//     createIds: v.array(v.id('lifelogs')),
//     updateIds: v.array(v.id('lifelogs')),
//     deleteIds: v.array(v.id('lifelogs')),
// });

export const isLifelogUpdated = internalQuery({
  args: {
    items: itemsArray,
  },
  handler: async (ctx, args) => {
    const createIds: string[] = [];
    const updateIds: string[] = [];
    const deleteIds: string[] = [];

    for (const item of args.items) {
        const lifelogs = await ctx.db.query('lifelogs')
            .withIndex('by_lifelog_id', q => q.eq('lifelogId', item.lifelogId))
            .collect()
        if (lifelogs.length === 0) {
            // No existing lifelog found, mark for creation
            createIds.push(item.lifelogId);
            continue;
        }
        if (lifelogs.length > 1) {
            console.warn(`Multiple lifelogs found for ID ${item.lifelogId}, using the first one.`);
            deleteIds.push(...lifelogs.slice(1).map(l => l._id));
        }
        const lifelog = lifelogs[0];
        if (item.updatedAt === undefined) {
            // If no updatedAt, skip
            continue;
        }
        if (lifelog.updatedAt !== undefined && item.updatedAt > lifelog.updatedAt) {
            // If the incoming updatedAt is greater, mark for update
            updateIds.push(lifelog._id);
        }
    }
    return { createIds, updateIds, deleteIds };
  },
});

export const handleUpdates = internalMutation({
    args: {
        create: v.array(lifelogDoc),
        update: v.array(v.object({
            id: v.id('lifelogs'),
            title: v.string(),
            markdown: v.union(v.string(), v.null()),
            embeddingId: v.optional(v.union(v.id('markdownEmbeddings'), v.null())),
            updatedAt: v.optional(v.number()),
            isStarred: v.optional(v.boolean()),
            contents: v.array(contentsNode),
            // startTime: v.optional(v.number()),
            // endTime: v.optional(v.number()),
            // lifelogId: v.string(),
        })),
        delete: v.array(v.id('lifelogs')),
    },
    handler: async (ctx, args) => {
        const createdIds: string[] = [];
        const updatedIds: string[] = [];
        const deletedIds: string[] = [];

        // Create new lifelogs
        for (const doc of args.create) {
            const createdId = await ctx.db.insert('lifelogs', doc);
            createdIds.push(createdId);
        }

        // Update existing lifelogs
        // Note: Not validated, may throw
        for (const doc of args.update) {
            const { id, ...updateData } = doc;
            await ctx.db.patch(id, updateData);
            updatedIds.push(id);
        }

        // Delete lifelogs
        for (const id of args.delete) {
            await ctx.db.delete(id);
            deletedIds.push(id);
        }

        return { createdIds, updatedIds, deletedIds };
    }
});