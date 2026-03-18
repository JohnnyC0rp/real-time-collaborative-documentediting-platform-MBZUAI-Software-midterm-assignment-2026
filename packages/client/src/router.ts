import { createRouter, createWebHistory } from "vue-router";
import DocumentListView from "./views/DocumentListView.vue";
import DocumentEditorView from "./views/DocumentEditorView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "document-list",
      component: DocumentListView
    },
    {
      path: "/documents/:id",
      name: "document-editor",
      component: DocumentEditorView
    }
  ]
});
