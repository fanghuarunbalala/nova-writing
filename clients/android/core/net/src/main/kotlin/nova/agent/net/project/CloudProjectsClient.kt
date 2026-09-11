package nova.agent.net.project

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.http.ServerApiException
import nova.agent.net.http.ServerHttp

@Serializable
data class CloudProject(
    val id: String,
    val name: String,
    @SerialName("createdAt") val createdAt: Long = 0,
    @SerialName("lastActivityAt") val lastActivityAt: Long? = null,
    @SerialName("archivedAt") val archivedAt: Long? = null,
)

@Serializable
data class ProjectFile(val path: String, val content: String, val updatedAt: Long = 0)

@Serializable
data class FileEntry(val path: String, val updatedAt: Long = 0, val size: Long = 0)

@Serializable
data class DomainEntity(
    val id: String,
    val kind: String,
    @SerialName("entityVersion") val entityVersion: Int = 0,
    val data: JsonElement = kotlinx.serialization.json.JsonNull,
    val seq: Long = 0,
    @SerialName("updatedAt") val updatedAt: Long = 0,
    @SerialName("deletedAt") val deletedAt: Long? = null,
)

@Serializable
data class DomainSnapshot(val cursor: Long, val entities: List<DomainEntity>)

@Serializable
data class DomainMutation(
    val kind: String,
    val id: String,
    val op: String, // put | delete
    val data: JsonElement? = null,
    @SerialName("baseVersion") val baseVersion: Int? = null,
)

@Serializable
data class DomainMutateResult(
    val results: List<DomainMutateEntry> = emptyList(),
    val seq: Long = 0,
)

@Serializable
data class DomainMutateEntry(val id: String, val kind: String, @SerialName("entityVersion") val entityVersion: Int? = null)

/**
 * 云项目 REST 封装（契约 §2/§3/§4）：项目生命周期 + 文件四件套（路径沙箱错误文案原样上抛）
 * + 域 snapshot/delta/mutate（409 stale_revision 附 currentVersion 在 extras）。
 */
class CloudProjectsClient(
    private val http: ServerHttp,
    private val auth: ServerAuthSession,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {

    private suspend fun token(): String =
        auth.ensureAccessToken() ?: throw ServerApiException(0, "not_logged_in", "server 未登录")

    // ---- 项目生命周期 ----

    suspend fun list(): List<CloudProject> {
        val body = http.request("GET", "/v1/projects", token()) ?: return emptyList()
        return json.decodeFromJsonElement(
            ListSerializer(CloudProject.serializer()),
            body["projects"] ?: return emptyList(),
        )
    }

    suspend fun create(name: String): CloudProject {
        val body = http.request("POST", "/v1/projects", token(), buildJsonObject { put("name", name) }, expect = intArrayOf(201))
            ?: throw ServerApiException(201, "bad_response", "建项目响应为空")
        return CloudProject(
            id = body.str("id") ?: throw ServerApiException(201, "bad_response", "响应缺少 id"),
            name = body.str("name") ?: "未命名项目",
        )
    }

    suspend fun rename(projectId: String, name: String): CloudProject =
        patchProject(projectId, buildJsonObject { put("name", name) })

    suspend fun setArchived(projectId: String, archived: Boolean): CloudProject =
        patchProject(projectId, buildJsonObject { put("archived", archived) })

    /** 软删（server 204；列表与 owner 校验即刻不可见）。 */
    suspend fun remove(projectId: String) {
        http.request("DELETE", "/v1/projects/$projectId", token(), expect = intArrayOf(204))
    }

    private suspend fun patchProject(projectId: String, body: JsonObject): CloudProject {
        val resp = http.request("PATCH", "/v1/projects/$projectId", token(), body)
            ?: throw ServerApiException(200, "bad_response", "项目响应为空")
        val project = resp["project"] as? JsonObject
            ?: throw ServerApiException(200, "bad_response", "响应缺少 project")
        return json.decodeFromJsonElement(CloudProject.serializer(), project)
    }

    // ---- 文件四件套 ----

    suspend fun readFile(projectId: String, path: String): ProjectFile {
        val body = http.request("GET", "/v1/projects/$projectId/files/${encodePath(path)}", token())
            ?: throw ServerApiException(200, "bad_response", "文件响应为空")
        return ProjectFile(
            path = body.str("path") ?: path,
            content = body.str("content") ?: "",
            updatedAt = body.long("updatedAt") ?: 0,
        )
    }

    suspend fun listFiles(projectId: String, prefix: String = ""): List<FileEntry> {
        val body = http.request("GET", "/v1/projects/$projectId/files?prefix=${encodePath(prefix)}", token())
            ?: return emptyList()
        return json.decodeFromJsonElement(ListSerializer(FileEntry.serializer()), body["files"] ?: return emptyList())
    }

    /** 写文件；413 too_large / 409 stale_file（extras 带 currentUpdatedAt）/ 403 novel_md_requires_approval 原样上抛。 */
    suspend fun writeFile(projectId: String, path: String, content: String, expectedUpdatedAt: Long? = null): Long {
        val body = buildJsonObject {
            put("content", content)
            expectedUpdatedAt?.let { put("expectedUpdatedAt", it) }
        }
        val resp = http.request("PUT", "/v1/projects/$projectId/files/${encodePath(path)}", token(), body)
        return resp?.long("updatedAt") ?: 0
    }

    suspend fun deleteFile(projectId: String, path: String) {
        http.request("DELETE", "/v1/projects/$projectId/files/${encodePath(path)}", token(), expect = intArrayOf(204))
    }

    // ---- 域 API ----

    suspend fun domainSnapshot(projectId: String): DomainSnapshot {
        val body = http.request("GET", "/v1/projects/$projectId/domain/snapshot", token())
            ?: return DomainSnapshot(0, emptyList())
        return DomainSnapshot(
            cursor = body.long("cursor") ?: 0,
            entities = json.decodeFromJsonElement(ListSerializer(DomainEntity.serializer()), body["entities"] ?: return DomainSnapshot(0, emptyList())),
        )
    }

    suspend fun domainDelta(projectId: String, since: Long): DomainSnapshot {
        val body = http.request("GET", "/v1/projects/$projectId/domain/delta?since=$since", token())
            ?: return DomainSnapshot(since, emptyList())
        return DomainSnapshot(
            cursor = body.long("cursor") ?: since,
            entities = json.decodeFromJsonElement(ListSerializer(DomainEntity.serializer()), body["entities"] ?: return DomainSnapshot(since, emptyList())),
        )
    }

    suspend fun domainMutate(
        projectId: String,
        conversationId: String,
        leaseToken: String?,
        mutations: List<DomainMutation>,
    ): DomainMutateResult {
        val body = buildJsonObject {
            put("conversationId", conversationId)
            put("leaseToken", leaseToken ?: "")
            put("mutations", json.encodeToJsonElement(ListSerializer(DomainMutation.serializer()), mutations))
        }
        val resp = http.request("POST", "/v1/projects/$projectId/domain/mutate", token(), body)
            ?: throw ServerApiException(200, "bad_response", "域写响应为空")
        return json.decodeFromJsonElement(
            DomainMutateResult.serializer(),
            kotlinx.serialization.json.buildJsonObject {
                put("results", resp["results"] ?: kotlinx.serialization.json.JsonArray(emptyList()))
                put("seq", resp["seq"] ?: kotlinx.serialization.json.JsonPrimitive(0))
            },
        )
    }

    private fun encodePath(path: String): String = java.net.URLEncoder.encode(path, "UTF-8")
}

private fun JsonObject.str(key: String): String? =
    (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.long(key: String): Long? =
    (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull()
