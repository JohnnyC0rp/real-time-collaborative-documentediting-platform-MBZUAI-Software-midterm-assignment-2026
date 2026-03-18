<template>
  <section class="panel">
    <RouterLink class="back-link" to="/">Back to documents</RouterLink>
    <h2>Document Editor</h2>

    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

    <div v-if="isLoading">Loading document...</div>

    <form v-else class="editor-form" @submit.prevent="onSave">
      <label for="editor-title">Title</label>
      <input id="editor-title" v-model="title" type="text" maxlength="120" required />

      <label for="editor-content">Content</label>
      <textarea
        id="editor-content"
        v-model="content"
        rows="16"
        placeholder="Write something..."
      />

      <div class="editor-actions">
        <button class="button" type="submit" :disabled="isSaving">Save</button>
        <span class="save-status">{{ saveStatus }}</span>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import { getDocument, updateDocument } from "../services/documentsApi";

const route = useRoute();
const documentId = computed(() => String(route.params.id ?? ""));

const isLoading = ref(false);
const isSaving = ref(false);
const title = ref("");
const content = ref("");
const errorMessage = ref("");
const saveStatus = ref("");

async function loadDocument(): Promise<void> {
  if (!documentId.value) {
    errorMessage.value = "Document id is missing";
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";
  saveStatus.value = "";

  try {
    const document = await getDocument(documentId.value);
    title.value = document.title;
    content.value = document.content;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to load document";
  } finally {
    isLoading.value = false;
  }
}

async function onSave(): Promise<void> {
  const trimmedTitle = title.value.trim();
  if (!trimmedTitle) {
    errorMessage.value = "Title is required";
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  saveStatus.value = "";

  try {
    const updated = await updateDocument(documentId.value, {
      title: trimmedTitle,
      content: content.value
    });
    title.value = updated.title;
    content.value = updated.content;
    saveStatus.value = `Saved at ${new Date(updated.updated_at).toLocaleTimeString()}`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to save document";
  } finally {
    isSaving.value = false;
  }
}

onMounted(() => {
  void loadDocument();
});
</script>
