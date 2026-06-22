import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConnectedAppsService } from './connected-apps.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import {
  CreateConnectedAppDto,
  UpdateConnectedAppDto,
} from '../../common/dto';

@ApiTags('connected-apps')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('connected-apps')
export class ConnectedAppsController {
  constructor(private service: ConnectedAppsService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'List connected apps for organization' })
  async findAll(@Query('organizationId') organizationId: string) {
    const apps = await this.service.findAll(organizationId);
    // SECURITY (M406/D2): admin-only + never expose the third-party api_key over HTTP.
    return apps.map(({ apiKey, ...rest }) => rest);
  }

  @Get(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Get connected app by ID' })
  async findOne(@Param('id') id: string) {
    const { apiKey, ...rest } = await this.service.findOne(id);
    return rest;
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Register a connected app' })
  async create(@Body() dto: CreateConnectedAppDto) {
    const { apiKey, ...rest } = await this.service.create(dto);
    return rest; // never echo api_key over HTTP (M406 defense-in-depth)
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a connected app' })
  async update(@Param('id') id: string, @Body() dto: UpdateConnectedAppDto) {
    const { apiKey, ...rest } = await this.service.update(id, dto);
    return rest;
  }

  @Put(':id/deactivate')
  @Roles('admin')
  @ApiOperation({ summary: 'Deactivate a connected app' })
  async deactivate(@Param('id') id: string) {
    const { apiKey, ...rest } = await this.service.deactivate(id);
    return rest;
  }
}
