<template>
  <section class="panel">
    <h2>Document List</h2>

    <form class="create-form" @submit.prevent="onCreate">
      <label for="title">New document title</label>
      <input
        id="title"
        v-model="newTitle"
        type="text"
        :maxlength="DOCUMENT_TITLE_MAX_LENGTH"
        required
      />
      <button class="button" type="submit" :disabled="isSubmitting">Create</button>
    </form>

    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

    <p v-if="isLoading">Loading documents...</p>
    <p v-else-if="documents.length === 0" class="empty-state">
      No documents yet. Create one to start editing.
    </p>

    <ul v-else class="document-list">
      <DocumentListItem
        v-for="document in documents"
        :key="document.id"
        :document="document"
        @delete="onDelete"
      />
    </ul>
  </section>
</template>

<script setup lang="ts">
import { DOCUMENT_TITLE_MAX_LENGTH, type DocumentRecord } from "@collab/shared";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import DocumentListItem from "../components/DocumentListItem.vue";
import {
  createDocument,
  deleteDocument,
  listDocuments
} from "../services/documentsApi";

const router = useRouter();
const documents = ref<DocumentRecord[]>([]);
const newTitle = ref("");
const errorMessage = ref("");
const isLoading = ref(false);
const isSubmitting = ref(false);

async function loadDocuments(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const response = await listDocuments();
    documents.value = response.documents;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to load documents";
  } finally {
    isLoading.value = false;
  }
}

async function onCreate(): Promise<void> {
  const title = newTitle.value.trim();
  if (!title) {
    errorMessage.value = "Title is required";
    return;
  }

  isSubmitting.value = true;
  errorMessage.value = "";

  try {
    const document = await createDocument({ title });
    newTitle.value = "";
    await router.push(`/documents/${document.id}`);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to create document";
  } finally {
    isSubmitting.value = false;
  }
}

async function onDelete(id: string): Promise<void> {
  errorMessage.value = "";

  try {
    await deleteDocument(id);
    documents.value = documents.value.filter((document) => document.id !== id);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to delete document";
  }
}

onMounted(() => {
  void loadDocuments();
});
</script>
