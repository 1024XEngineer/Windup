export class CreatorAssets {
  #Editor

  constructor(Editor) {
    if (!Editor?.Message?.request || !Editor?.Message?.send) {
      throw new Error('CREATOR_MESSAGE_API_UNAVAILABLE')
    }
    this.#Editor = Editor
  }

  refresh(dbUrl) {
    return this.#Editor.Message.request('asset-db', 'refresh-asset', dbUrl)
  }

  query(dbUrl) {
    return this.#Editor.Message.request('asset-db', 'query-asset-info', dbUrl)
  }

  async reveal(dbUrl) {
    const asset = await this.query(dbUrl)
    if (!asset?.uuid) throw new Error(`CREATOR_ASSET_NOT_FOUND: ${dbUrl}`)
    this.#Editor.Message.send('assets', 'twinkle', asset.uuid)
  }
}
