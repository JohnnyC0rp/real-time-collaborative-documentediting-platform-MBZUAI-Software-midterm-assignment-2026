<template>
  <li class="document-item">
    <div>
      <h3>{{ document.title }}</h3>
      <p class="meta">Updated: {{ formatDate(document.updated_at) }}</p>
    </div>
    <div class="actions">
      <RouterLink class="button" :to="`/documents/${document.id}`">Open</RouterLink>
      <button class="button danger" type="button" @click="$emit('delete', document.id)">
        Delete
      </button>
    </div>
  </li>
</template>

<script setup lang="ts">
import type { DocumentRecord } from "@collab/shared";
import { RouterLink } from "vue-router";

defineProps<{
  document: DocumentRecord;
}>();

defineEmits<{
  delete: [id: string];
}>();

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
</script>
